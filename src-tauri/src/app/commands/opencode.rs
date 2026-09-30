// ============================================
// OpenCode Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

use crate::app::service::ServiceState;
use serde::Serialize;
use std::{
    collections::VecDeque,
    env,
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::Ordering, mpsc},
    thread,
    time::Duration,
};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOpencodeServiceResult {
    started: bool,
    started_by_us: bool,
    url: Option<String>,
}

struct SpawnedOpencodeServe {
    child: Child,
    output: mpsc::Receiver<String>,
}

/// 检查 opencode 服务是否在运行（通过 /api/info）
pub async fn is_service_running(url: &str) -> bool {
    is_service_running_with_auth(url, None).await
}

/// 校验响应体是否是 OpenCode V2 `/api/info` 的形状。
///
/// V2 的响应形如：
/// ```json
/// {"version":"2.0.19","pid":76002,"urls":["http://127.0.0.1:4097"],"paths":{"tmp":"/tmp/opencode"}}
/// ```
/// **注意没有 `healthy` 字段** —— V1 的 `/global/health` 才有。
/// 所以判活只能靠结构校验：`version` 是非空字符串 + `pid` 是数字 + `urls` 是数组。
///
/// 依据（v2.0.19 源码，两处都返回同一形状，均无 `healthy`）：
///   - 未就绪时：packages/server/src/process.ts:208
///       `{ version, pid: process.pid, urls: urls(), paths: { tmp } }`
///   - 就绪时：  packages/server/src/handlers/server.ts:18-21
///       （ServerInfo.Service 提供 urls / paths.tmp，pid 同样是 process.pid）
/// 就绪判定要点：未就绪时该响应带 HTTP 503（process.ts:211），
/// 只有 200 才是 ready，所以上面的 `status().is_success()` 前置判断不能去掉。
fn is_opencode_info_body(body: &serde_json::Value) -> bool {
    let version_ok = body
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let pid_ok = body.get("pid").map(|v| v.is_number()).unwrap_or(false);
    let urls_ok = body.get("urls").map(|v| v.is_array()).unwrap_or(false);
    version_ok && pid_ok && urls_ok
}

/// 带可选 Basic 鉴权的健康检查（OpenCode V2）
///
/// 🔴 为什么必须改（阶段 1 实测 + 源码确认）：
/// V1 的实现是「先试 `/api/health`，再试 `/global/health`，**只看 HTTP 状态码**」。
/// 在 V2 下这会变成**静默假阳性**：
///   1. `/api/health`  → 404（非 2xx）→ 继续试下一个
///   2. `/global/health` → **200**，但返回的是 **SPA 兜底 HTML 页**（V2 没有这个路由）
///   3. `status().is_success()` 为真 → 判定「服务在运行」
/// 结果：**任何**在该路径返回 200 的 HTTP 服务都会被当成「opencode 健康」，
/// 校验能力归零，而且是**静默失效**（不报错、不提示）。
///
/// ✅ V2 的正确做法（迁移文档 §9.3）：
///   - 端点换成 **`GET /api/info`**（`/global/health` 在二进制里已彻底移除）
///   - 判活**不能只看状态码**，还要校验响应体形状（见 `is_opencode_info_body`）
pub async fn is_service_running_with_auth(url: &str, auth: Option<(&str, &str)>) -> bool {
    let base = url.trim_end_matches('/');
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let mut request = client.get(format!("{}/api/info", base));
    if let Some((username, password)) = auth {
        request = request.basic_auth(username, Some(password));
    }

    let response = match request.timeout(Duration::from_secs(5)).send().await {
        Ok(r) => r,
        Err(_) => return false,
    };

    if !response.status().is_success() {
        return false;
    }

    // 关键：不能只看状态码。
    // 这里不用 response.json()，因为 Cargo.toml 里 reqwest 关了默认特性、
    // 没有启用 "json" feature；用 text() + serde_json 手动解析，零额外依赖。
    match response.text().await {
        Ok(body) => serde_json::from_str::<serde_json::Value>(&body)
            .map(|value| is_opencode_info_body(&value))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// 启动 opencode serve 进程
fn spawn_opencode_serve(
    binary_path: &str,
    env_vars: &std::collections::HashMap<String, String>,
) -> Result<SpawnedOpencodeServe, String> {
    log::info!("Starting opencode serve with binary: {}", binary_path);
    if !env_vars.is_empty() {
        log::info!("Injecting {} environment variable(s)", env_vars.len());
    }

    // 只传 `serve`，不附加任何参数：v2.0.19 的 serve 子命令
    // （packages/cli/src/commands/commands.ts:517）允许 hostname / port 缺省，
    // 缺省时 hostname=127.0.0.1、port 由系统随机分配一个空闲端口，随后通过
    // `server listening on http://127.0.0.1:<port>` 这行 stdout 回传，
    // 交给下面的 parse_listening_url() 解析（已实测确认）。
    // 刻意不传 --log-level：该 flag 只接受小写取值，不传就不会踩大小写坑。
    let serve_args = ["serve".to_string()];

    let mut cmd = build_opencode_command(binary_path, &serve_args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // 注入用户配置的环境变量（设置页「环境变量」里手填的键值对）。
    //
    // 非 WSL 路径**不硬编码任何 OPENCODE_* 变量**——已逐项核对 v2.0.19，
    // 这里没有需要修的无效变量。唯一有语义差异的是文件监听：本路径不设
    // OPENCODE_FILEWATCHER_DISABLE，filewatcher 因此保持**开启**
    // （server-process.ts:120 的默认值）。这与官方桌面版对本地服务端的意图一致
    // （lifecycle/environment.ts:30 意图开启；顺带一提，它用的
    // OPENCODE_EXPERIMENTAL_FILEWATCHER 在 v2.0.19 同样是零读取处的死变量）。
    // WSL 路径则相反，显式关闭 filewatcher（跨 /mnt/* 监听代价高）。
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start '{}': {}. Check that the path is correct.",
            binary_path, e
        )
    })?;

    let (tx, output) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        spawn_output_reader(stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_output_reader(stderr, tx);
    }

    Ok(SpawnedOpencodeServe { child, output })
}

fn spawn_output_reader<R>(reader: R, tx: mpsc::Sender<String>)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut tx = Some(tx);
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(sender) = tx.as_ref() {
                if sender.send(line).is_err() {
                    tx = None;
                }
            }
        }
    });
}

/// 从 opencode serve 的 stdout 里提取监听 URL。
///
/// v2.0.19 打印这行的位置：packages/cli/src/server-process.ts:163
///   console.log(options.mode === "stdio" ? JSON.stringify({ url })
///                                          : `server listening on ${url}`)
/// 即 `server listening on http://127.0.0.1:<port>`（url 来自
/// HttpServer.formatAddress，**不带结尾斜杠**）。
/// 已在本机 v2.0.19 二进制上实测确认该格式；且它**不依赖 --print-logs**
/// （console.log 直写 stdout，不经过 logger，所以本路径不传该 flag 也能拿到）。
///
/// 本函数只做「找 http(s):// 再取第一个空白分隔的片段」，因此对前缀措辞
/// （"server listening on"）不敏感；额外把 0.0.0.0 归一成 127.0.0.1，
/// 以适配显式传 --hostname 0.0.0.0 的场景。
fn parse_listening_url(line: &str) -> Option<String> {
    let start = line.find("http://").or_else(|| line.find("https://"))?;
    let raw_url = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches(|c| matches!(c, ',' | ';' | ')'));
    let normalized = raw_url
        .replace("http://0.0.0.0:", "http://127.0.0.1:")
        .replace("https://0.0.0.0:", "https://127.0.0.1:");
    let parsed = reqwest::Url::parse(&normalized).ok()?;

    Some(parsed.to_string().trim_end_matches('/').to_string())
}

fn remember_recent_output(recent_output: &mut VecDeque<String>, line: String) {
    if recent_output.len() >= 8 {
        recent_output.pop_front();
    }
    recent_output.push_back(line);
}

fn format_recent_output(recent_output: &VecDeque<String>) -> String {
    if recent_output.is_empty() {
        return String::new();
    }

    format!(
        " Recent output: {}",
        recent_output
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ")
    )
}

fn build_opencode_command(binary_path: &str, args: &[String]) -> Command {
    #[cfg(target_os = "windows")]
    {
        let path = Path::new(binary_path);
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let requires_shell = ext.eq_ignore_ascii_case("cmd")
            || ext.eq_ignore_ascii_case("bat")
            || path.extension().is_none();

        if requires_shell {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C").arg(binary_path).args(args);
            return cmd;
        }
    }

    let mut cmd = Command::new(binary_path);
    cmd.args(args);
    cmd
}

fn patched_env_var(
    env_vars: &std::collections::HashMap<String, String>,
    key: &str,
) -> Option<OsString> {
    for (env_key, value) in env_vars {
        if env_key.eq_ignore_ascii_case(key) {
            return Some(OsString::from(value));
        }
    }
    env::var_os(key)
}

fn path_candidates(env_vars: &std::collections::HashMap<String, String>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(bin) = patched_env_var(env_vars, "OPENCODE_BIN") {
        if !bin.is_empty() {
            candidates.push(PathBuf::from(bin));
        }
    }

    let Some(path) = patched_env_var(env_vars, "PATH") else {
        return candidates;
    };

    let names: Vec<&str> = if cfg!(windows) {
        vec!["opencode.exe", "opencode.cmd", "opencode.bat", "opencode"]
    } else {
        vec!["opencode"]
    };

    for dir in env::split_paths(&path) {
        for name in &names {
            candidates.push(dir.join(name));
        }
    }

    candidates
}

fn is_runnable_file(path: &Path) -> bool {
    path.is_file()
}

/// 自动检测 opencode 可执行文件，行为接近直接在终端输入 `opencode`。
#[tauri::command]
pub async fn detect_opencode_binary(
    env_vars: std::collections::HashMap<String, String>,
) -> Result<Option<String>, String> {
    for candidate in path_candidates(&env_vars) {
        if is_runnable_file(&candidate) {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

/// 跨平台杀进程
pub fn kill_process_by_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// 检查 opencode 服务是否在运行
#[tauri::command]
pub async fn check_opencode_service(url: String) -> Result<bool, String> {
    Ok(is_service_running(&url).await)
}

/// 启动 opencode serve
#[tauri::command]
pub async fn start_opencode_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
) -> Result<StartOpencodeServiceResult, String> {
    if state.we_started.load(Ordering::SeqCst) {
        let current_url = state.service_url.lock().map_err(|e| e.to_string())?.clone();
        if let Some(current_url) = current_url {
            if is_service_running(&current_url).await {
                log::info!("opencode service already running at {}", current_url);
                return Ok(StartOpencodeServiceResult {
                    started: false,
                    started_by_us: true,
                    url: Some(current_url),
                });
            }
        }
    }

    if is_service_running(&url).await {
        log::info!("opencode service already running at {}", url);
        return Ok(StartOpencodeServiceResult {
            started: false,
            started_by_us: false,
            url: Some(url),
        });
    }

    let mut spawned = spawn_opencode_serve(&binary_path, &env_vars)?;
    let pid = spawned.child.id();
    log::info!("Started opencode serve, PID: {}", pid);

    state.child_pid.store(pid, Ordering::SeqCst);
    state.we_started.store(true, Ordering::SeqCst);
    *state.service_url.lock().map_err(|e| e.to_string())? = None;

    let mut detected_url: Option<String> = None;
    let mut recent_output = VecDeque::new();

    for _ in 0..30 {
        while let Ok(line) = spawned.output.try_recv() {
            if let Some(parsed_url) = parse_listening_url(&line) {
                log::info!("Detected opencode serve URL: {}", parsed_url);
                *state.service_url.lock().map_err(|e| e.to_string())? = Some(parsed_url.clone());
                detected_url = Some(parsed_url);
            }
            remember_recent_output(&mut recent_output, line);
        }

        if let Some(status) = spawned.child.try_wait().map_err(|e| e.to_string())? {
            state.child_pid.store(0, Ordering::SeqCst);
            state.we_started.store(false, Ordering::SeqCst);
            *state.service_url.lock().map_err(|e| e.to_string())? = None;
            return Err(format!(
                "opencode serve exited during startup with status {}.{}",
                status,
                format_recent_output(&recent_output)
            ));
        }

        let health_url = detected_url.as_deref().unwrap_or(&url);
        if is_service_running(health_url).await {
            log::info!("opencode service is ready at {}", health_url);
            *state.service_url.lock().map_err(|e| e.to_string())? = Some(health_url.to_string());
            return Ok(StartOpencodeServiceResult {
                started: true,
                started_by_us: true,
                url: Some(health_url.to_string()),
            });
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    log::warn!("opencode service started but health check not passing yet");
    Ok(StartOpencodeServiceResult {
        started: true,
        started_by_us: true,
        url: detected_url,
    })
}

/// 停止 opencode serve
#[tauri::command]
pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
    let pid = state.child_pid.swap(0, Ordering::SeqCst);
    state.we_started.store(false, Ordering::SeqCst);
    *state.service_url.lock().map_err(|e| e.to_string())? = None;

    if pid > 0 {
        log::info!("Stopping opencode serve, PID: {}", pid);
        kill_process_by_pid(pid);
    }

    Ok(())
}

/// 查询是否由我们启动了 opencode 服务
#[tauri::command]
pub async fn get_service_started_by_us(state: State<'_, ServiceState>) -> Result<bool, String> {
    Ok(state.we_started.load(Ordering::SeqCst))
}

/// 确认关闭应用（前端调用，可选择是否同时停止服务）
#[tauri::command]
pub async fn confirm_close_app(
    window: tauri::Window,
    state: State<'_, ServiceState>,
    stop_service: bool,
) -> Result<(), String> {
    // 我们启动的 WSL 内 opencode 进程随应用退出统一清理，避免后台残留
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let wsl_state = window.app_handle().state::<super::wsl_commands::WslState>();
        super::wsl_commands::stop_all_wsl_servers(&wsl_state).await;
    }

    if stop_service {
        let pid = state.child_pid.swap(0, Ordering::SeqCst);
        if pid > 0 {
            log::info!("Closing app and stopping opencode serve, PID: {}", pid);
            kill_process_by_pid(pid);
        }
        state.we_started.store(false, Ordering::SeqCst);
        *state.service_url.lock().map_err(|e| e.to_string())? = None;
    } else {
        log::info!("Closing app, keeping opencode serve running");
    }

    window.destroy().map_err(|e| e.to_string())
}
