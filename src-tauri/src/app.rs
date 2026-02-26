// ============================================
// Tauri Application Entry Point
// SSE Bridge + Plugin Registration + Service Management
// ============================================

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{ipc::Channel, Manager, State};

// Desktop-only imports for service management
#[cfg(not(target_os = "android"))]
use std::process::{Command, Stdio};
#[cfg(not(target_os = "android"))]
use std::sync::atomic::AtomicBool;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

// ============================================
// SSE Connection State
// ============================================

/// 用于管理 SSE 连接的全局状态（支持多窗口）
/// 每个窗口独立维护自己的 SSE 连接，互不干扰
struct SseState {
    /// 每次连接分配一个递增 ID，用于区分不同连接
    next_id: AtomicU64,
    /// 每个窗口的活跃连接 ID: window label → connection ID
    active: Mutex<HashMap<String, u64>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            active: Mutex::new(HashMap::new()),
        }
    }
}

// ============================================
// SSE Event Types (sent to frontend via Channel)
// ============================================

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum SseEvent {
    /// SSE 连接已建立
    Connected,
    /// 收到一条 SSE 数据（已解析的 JSON 字符串）
    #[serde(rename_all = "camelCase")]
    Message {
        /// 原始 JSON 字符串，前端自行解析
        raw: String,
    },
    /// SSE 连接断开（正常结束）
    Disconnected { reason: String },
    /// SSE 连接出错
    Error { message: String },
}

// ============================================
// SSE Commands
// ============================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SseConnectArgs {
    url: String,
    auth_header: Option<String>,
}

/// 连接 SSE 流
///
/// 通过 reqwest 在 Rust 侧建立 SSE 连接，完全绕过 WebView 的 CORS 限制。
/// 使用 Tauri Channel 将事件流式发送给前端。
#[tauri::command]
async fn sse_connect(
    window: tauri::Window,
    state: State<'_, SseState>,
    args: SseConnectArgs,
    on_event: Channel<SseEvent>,
) -> Result<(), String> {
    // 分配连接 ID（per-window，多窗口互不干扰）
    let conn_id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let win_label = window.label().to_string();
    state.active.lock().unwrap().insert(win_label.clone(), conn_id);

    // 构建请求 - 配置超时防止连接静默死亡
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // 注意：不设置 read timeout，因为 SSE 是长连接，空闲时间可能很长
        // 改用下面的 tokio::time::timeout 包装每次 chunk 读取
        .tcp_keepalive(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let mut req = client.get(&args.url);

    if let Some(ref auth) = args.auth_header {
        req = req.header("Authorization", auth);
    }

    // 发起请求
    let response = req.send().await.map_err(|e| {
        let msg = format!("SSE connection failed: {}", e);
        let _ = on_event.send(SseEvent::Error {
            message: msg.clone(),
        });
        msg
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let msg = format!("SSE server returned {}", status);
        let _ = on_event.send(SseEvent::Error {
            message: msg.clone(),
        });
        return Err(msg);
    }

    // 通知前端已连接
    let _ = on_event.send(SseEvent::Connected);

    // 流式读取 SSE
    // 使用 timeout 包装每次 chunk 读取，防止连接静默断开后永远挂起
    // SSE 服务端通常每 30-60 秒发送心跳，90 秒无数据基本可以判定连接已死
    const READ_TIMEOUT: Duration = Duration::from_secs(90);
    
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut event_data = String::new();

    loop {
        // 检查该窗口的连接是否被要求断开
        if state.active.lock().unwrap().get(&win_label) != Some(&conn_id) {
            let _ = on_event.send(SseEvent::Disconnected {
                reason: "Disconnected by client".to_string(),
            });
            return Ok(());
        }

        match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                // 按行解析 SSE 协议
                while let Some(newline_pos) = buffer.find('\n') {
                    let line = buffer[..newline_pos].to_string();
                    buffer = buffer[newline_pos + 1..].to_string();

                    let line = line.trim_end_matches('\r');

                    if let Some(stripped) = line.strip_prefix("data:") {
                        let data = stripped.trim();
                        if !data.is_empty() {
                            if !event_data.is_empty() {
                                event_data.push('\n');
                            }
                            event_data.push_str(data);
                        }
                        continue;
                    }

                    if line.is_empty() {
                        if !event_data.is_empty() {
                            let _ = on_event.send(SseEvent::Message {
                                raw: event_data.clone(),
                            });
                            event_data.clear();
                        }
                        continue;
                    }

                    // 忽略 event:, id:, retry: 等 SSE 字段
                }
            }
            Ok(Some(Err(e))) => {
                let msg = format!("SSE stream error: {}", e);
                let _ = on_event.send(SseEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
            Ok(None) => {
                if !event_data.is_empty() {
                    let _ = on_event.send(SseEvent::Message {
                        raw: event_data.clone(),
                    });
                }
                // 流结束
                let _ = on_event.send(SseEvent::Disconnected {
                    reason: "Stream ended".to_string(),
                });
                return Ok(());
            }
            Err(_) => {
                // 读取超时 — 连接可能已经静默断开
                let msg = format!("SSE read timeout ({}s without data)", READ_TIMEOUT.as_secs());
                let _ = on_event.send(SseEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
        }
    }
}

/// 断开 SSE 连接
#[tauri::command]
async fn sse_disconnect(window: tauri::Window, state: State<'_, SseState>) -> Result<(), String> {
    state.active.lock().unwrap().remove(window.label());
    Ok(())
}

// ============================================
// Open Directory State (desktop only)
// 存储启动时传入的目录路径（右键菜单、拖放等）
// ============================================

#[cfg(not(target_os = "android"))]
struct OpenDirectoryState {
    /// per-window 待处理目录: window label → directory path
    pending: Mutex<HashMap<String, String>>,
}

#[cfg(not(target_os = "android"))]
impl Default for OpenDirectoryState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

/// 从命令行参数中提取目录路径
#[cfg(not(target_os = "android"))]
fn extract_directory_from_args(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        if std::path::Path::new(arg).is_dir() {
            return Some(arg.clone());
        }
    }
    None
}

/// 获取启动时传入的目录路径（一次性读取后清空）
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn get_cli_directory(window: tauri::Window, state: State<'_, OpenDirectoryState>) -> Option<String> {
    state.pending.lock().ok()?.remove(window.label())
}

// ============================================
// OpenCode Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

#[cfg(not(target_os = "android"))]
mod service {
    use super::*;

    /// 跟踪我们是否启动了 opencode serve 进程
    pub struct ServiceState {
        /// 我们启动的子进程 PID
        pub child_pid: Mutex<Option<u32>>,
        /// 是否由我们启动（用于关闭时判断是否需要询问）
        pub we_started: AtomicBool,
    }

    impl Default for ServiceState {
        fn default() -> Self {
            Self {
                child_pid: Mutex::new(None),
                we_started: AtomicBool::new(false),
            }
        }
    }

    /// 检查 opencode 服务是否在运行（通过 health endpoint）
    pub async fn is_service_running(url: &str) -> bool {
        let health_url = format!("{}/global/health", url.trim_end_matches('/'));
        match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .build()
        {
            Ok(client) => client
                .get(&health_url)
                .timeout(Duration::from_secs(5))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    /// 启动 opencode serve 进程
    fn spawn_opencode_serve(
        binary_path: &str,
        env_vars: &std::collections::HashMap<String, String>,
    ) -> Result<std::process::Child, String> {
        log::info!("Starting opencode serve with binary: {}", binary_path);
        if !env_vars.is_empty() {
            log::info!("Injecting {} environment variable(s)", env_vars.len());
        }

        let mut cmd = Command::new(binary_path);
        cmd.arg("serve")
            .stdout(Stdio::null())
            .stderr(Stdio::null());

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

        cmd.spawn().map_err(|e| {
            format!(
                "Failed to start '{}': {}. Check that the path is correct.",
                binary_path, e
            )
        })
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
    ) -> Result<bool, String> {
        if is_service_running(&url).await {
            log::info!("opencode service already running at {}", url);
            return Ok(false);
        }

        let child = spawn_opencode_serve(&binary_path, &env_vars)?;
        let pid = child.id();
        log::info!("Started opencode serve, PID: {}", pid);

        *state.child_pid.lock().map_err(|e| e.to_string())? = Some(pid);
        state.we_started.store(true, Ordering::SeqCst);

        for _ in 0..30 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if is_service_running(&url).await {
                log::info!("opencode service is ready at {}", url);
                return Ok(true);
            }
        }

        log::warn!("opencode service started but health check not passing yet");
        Ok(true)
    }

    /// 停止 opencode serve
    #[tauri::command]
    pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
        let pid = state.child_pid.lock().map_err(|e| e.to_string())?.take();
        state.we_started.store(false, Ordering::SeqCst);

        if let Some(pid) = pid {
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
        if stop_service {
            let pid = state.child_pid.lock().map_err(|e| e.to_string())?.take();
            if let Some(pid) = pid {
                log::info!("Closing app and stopping opencode serve, PID: {}", pid);
                kill_process_by_pid(pid);
            }
            state.we_started.store(false, Ordering::SeqCst);
        } else {
            log::info!("Closing app, keeping opencode serve running");
        }

        window.destroy().map_err(|e| e.to_string())
    }
}

/// 创建新窗口，可选地关联一个目录（多窗口支持）
#[cfg(not(target_os = "android"))]
fn create_new_window(app: &tauri::AppHandle, directory: Option<String>) {
    static WIN_COUNTER: AtomicU64 = AtomicU64::new(1);
    let label = format!("win-{}", WIN_COUNTER.fetch_add(1, Ordering::SeqCst));

    if let Some(ref dir) = directory {
        if let Some(state) = app.try_state::<OpenDirectoryState>() {
            state.pending.lock().unwrap().insert(label.clone(), dir.clone());
        }
    }

    match tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("OpenCode")
    .inner_size(800.0, 600.0)
    .build()
    {
        Ok(_) => log::info!("Created new window '{}' for directory: {:?}", label, directory),
        Err(e) => log::error!("Failed to create new window: {}", e),
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(SseState::default());

    // Desktop: 注册 OpenDirectoryState + single-instance 插件（需在 setup 之前）
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .manage(OpenDirectoryState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 始终新建窗口（类似 VSCode：双击图标 = 新窗口）
            let dir = extract_directory_from_args(&args);
            log::info!("Single-instance: opening new window, directory: {:?}", dir);
            create_new_window(app, dir);
        }));

    let builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 始终启用 log 插件，方便排查问题
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // 自动打开 devtools，方便调试（相当于浏览器 F12）
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // Desktop: 解析 CLI 参数，存入 pending state
            #[cfg(not(target_os = "android"))]
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(dir) = extract_directory_from_args(&args) {
                    log::info!("CLI directory argument: {}", dir);
                    if let Some(state) = app.try_state::<OpenDirectoryState>() {
                        state.pending.lock().unwrap().insert("main".to_string(), dir);
                    }
                }
            }

            Ok(())
        });

    // Desktop: 注册 service management commands + 窗口关闭拦截
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .manage(service::ServiceState::default())
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // 只在最后一个窗口关闭时询问是否停止服务
                    let is_last = window.app_handle().webview_windows().len() <= 1;
                    if is_last {
                        let state = window.state::<service::ServiceState>();
                        if state.we_started.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = window.emit("close-requested", ());
                        }
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    // 窗口销毁时清理该窗口的 SSE 连接
                    let state = window.state::<SseState>();
                    state.active.lock().unwrap().remove(window.label());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            sse_connect,
            sse_disconnect,
            get_cli_directory,
            service::check_opencode_service,
            service::start_opencode_service,
            service::stop_opencode_service,
            service::get_service_started_by_us,
            service::confirm_close_app,
        ]);

    // Android: 只注册 SSE commands
    #[cfg(target_os = "android")]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            sse_connect,
            sse_disconnect,
        ]);

    // build + run 分开调用，以支持 macOS RunEvent::Opened
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // macOS: 处理 Finder "Open with" / 拖文件夹到 Dock 图标
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if path.is_dir() {
                        let dir = path.to_string_lossy().to_string();
                        log::info!("macOS Opened directory: {}", dir);

                        // 如果只有 main 窗口且它还没消费目录，说明是冷启动，设给 main
                        // 否则新建窗口
                        if let Some(state) = _app_handle.try_state::<OpenDirectoryState>() {
                            let mut pending = state.pending.lock().unwrap();
                            let win_count = _app_handle.webview_windows().len();
                            if win_count <= 1 && !pending.contains_key("main") {
                                pending.insert("main".to_string(), dir.clone());
                                drop(pending);
                                let _ = _app_handle.emit("open-directory", dir);
                            } else {
                                drop(pending);
                                create_new_window(_app_handle, Some(dir));
                            }
                        }
                    }
                }
            }
        }
    });
}
