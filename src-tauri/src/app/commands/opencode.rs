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
    /// v2 服务端生成的随机密码（无 OPENCODE_SERVER_PASSWORD 时
    /// serve 自动生成并打印 `server password <pwd>` 到 stdout——
    /// 官方 cli/server-process.ts:160 同款契约）。用户显式配置密码时
    /// 服务端不打印，这里为 None（前端继续用条目上已有的凭据）。
    server_password: Option<String>,
}

struct SpawnedOpencodeServe {
    child: Child,
    output: mpsc::Receiver<String>,
}

/// 带可选 Basic 鉴权的健康检查，对齐官方实现：
/// v2 客户端用 server.info()（GET /api/info）探测；/global/health 是 v1 端点，
/// 保留为旧版后端的回退。WSL 侧 serve 启用了密码保护，
/// 不带凭据会收到 401 而误判为未就绪。
pub async fn is_service_running_with_auth(url: &str, auth: Option<(&str, &str)>) -> bool {
    let base = url.trim_end_matches('/');
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    for path in ["/api/info", "/global/health"] {
        let mut request = client.get(format!("{}{}", base, path));
        if let Some((username, password)) = auth {
            request = request.basic_auth(username, Some(password));
        }
        // v2 服务器对未知路径会回退到 SPA 的 HTML（也是 200），
        // 因此必须确认返回的是 JSON
        let is_json_ok = request
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map(|r| {
                r.status().is_success()
                    && r.headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .map(|ct| ct.to_ascii_lowercase().contains("application/json"))
                        .unwrap_or(false)
            })
            .unwrap_or(false);
        if is_json_ok {
            return true;
        }
    }
    false
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

    let serve_args = ["serve".to_string()];

    let mut cmd = build_opencode_command(binary_path, &serve_args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // 注入用户配置的环境变量
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

/// 提取 v2 服务端自动生成的随机密码（官方 cli/server-process.ts:160：
/// `server password <pwd>` 打到 stdout）
fn parse_server_password(line: &str) -> Option<String> {
    let password = line.trim().strip_prefix("server password ")?.trim();
    if password.is_empty() {
        return None;
    }
    Some(password.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_listening_url, parse_server_password};

    #[test]
    fn parses_generated_password_line() {
        assert_eq!(
            parse_server_password("server password 10oCmAyibNWQdMSa-NBRdSsDA5fcedgh__w2RkRA7s8"),
            Some("10oCmAyibNWQdMSa-NBRdSsDA5fcedgh__w2RkRA7s8".to_string())
        );
        // 带尾随空白/多余空行也要命中
        assert_eq!(
            parse_server_password("  server password abc123  "),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn ignores_non_password_lines() {
        assert_eq!(parse_server_password("server listening on http://127.0.0.1:4097"), None);
        assert_eq!(parse_server_password("server password "), None);
        assert_eq!(parse_server_password(""), None);
    }

    #[test]
    fn listening_url_and_password_coexist() {
        // v2.0.14 实机启动输出的两行：URL 与随机密码各自被对应解析器命中
        let url_line = "server listening on http://127.0.0.1:4097";
        let password_line = "server password 10oCmAyibNWQdMSa-NBRdSsDA5fcedgh__w2RkRA7s8";
        assert_eq!(parse_listening_url(url_line).as_deref(), Some("http://127.0.0.1:4097"));
        assert_eq!(parse_server_password(url_line), None);
        assert!(parse_server_password(password_line).is_some());
        assert_eq!(parse_listening_url(password_line), None);
    }
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

/// 检查 opencode 服务是否在运行（带可选 Basic 凭据——v2 强制密码，
/// 无凭据的健康检查会 401 误判成未运行）
#[tauri::command]
pub async fn check_opencode_service(url: String, auth: Option<(String, String)>) -> Result<bool, String> {
    let health_auth = auth
        .as_ref()
        .map(|(username, password)| (username.as_str(), password.as_str()));
    Ok(is_service_running_with_auth(&url, health_auth).await)
}

/// 启动 opencode serve
#[tauri::command]
pub async fn start_opencode_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
    auth: Option<(String, String)>,
) -> Result<StartOpencodeServiceResult, String> {
    // 「已经在跑」的探测要带条目上已有的凭据——v2 服务端强制随机密码，
    // 不带凭据的探测会 401 误判成没在跑，进而尝试重复 spawn 撞端口
    let health_auth = auth
        .as_ref()
        .map(|(username, password)| (username.as_str(), password.as_str()));
    if state.we_started.load(Ordering::SeqCst) {
        let current_url = state.service_url.lock().map_err(|e| e.to_string())?.clone();
        if let Some(current_url) = current_url {
            if is_service_running_with_auth(&current_url, health_auth).await {
                log::info!("opencode service already running at {}", current_url);
                return Ok(StartOpencodeServiceResult {
                    started: false,
                    started_by_us: true,
                    url: Some(current_url),
                    server_password: None,
                });
            }
        }
    }

    if is_service_running_with_auth(&url, health_auth).await {
        log::info!("opencode service already running at {}", url);
        return Ok(StartOpencodeServiceResult {
            started: false,
            started_by_us: false,
            url: Some(url),
            server_password: None,
        });
    }

    let mut spawned = spawn_opencode_serve(&binary_path, &env_vars)?;
    let pid = spawned.child.id();
    log::info!("Started opencode serve, PID: {}", pid);

    state.child_pid.store(pid, Ordering::SeqCst);
    state.we_started.store(true, Ordering::SeqCst);
    *state.service_url.lock().map_err(|e| e.to_string())? = None;

    let mut detected_url: Option<String> = None;
    let mut detected_password: Option<String> = None;
    let mut recent_output = VecDeque::new();

    for _ in 0..30 {
        while let Ok(line) = spawned.output.try_recv() {
            if let Some(parsed_url) = parse_listening_url(&line) {
                log::info!("Detected opencode serve URL: {}", parsed_url);
                *state.service_url.lock().map_err(|e| e.to_string())? = Some(parsed_url.clone());
                detected_url = Some(parsed_url);
            }
            if detected_password.is_none() {
                if let Some(password) = parse_server_password(&line) {
                    log::info!("Detected opencode serve generated password");
                    detected_password = Some(password);
                }
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
        // 就绪检查的凭据来源（按优先级）：
        // 1. 服务端刚打印的随机密码（未显式配置时强制生成）
        // 2. 条目上已有的凭据（用户通过 env 配了 OPENCODE_SERVER_PASSWORD
        //    时服务端不打印，但只要条目 auth 与之匹配就能秒级就绪，
        //    否则 401 每次迭代全失败、白等 15 秒超时才返回）
        let ready_auth = detected_password
            .as_deref()
            .map(|password| ("opencode", password))
            .or(health_auth);
        if is_service_running_with_auth(health_url, ready_auth).await {
            log::info!("opencode service is ready at {}", health_url);
            *state.service_url.lock().map_err(|e| e.to_string())? = Some(health_url.to_string());
            return Ok(StartOpencodeServiceResult {
                started: true,
                started_by_us: true,
                url: Some(health_url.to_string()),
                server_password: detected_password,
            });
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    log::warn!("opencode service started but health check not passing yet");
    Ok(StartOpencodeServiceResult {
        started: true,
        started_by_us: true,
        url: detected_url,
        server_password: detected_password,
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
