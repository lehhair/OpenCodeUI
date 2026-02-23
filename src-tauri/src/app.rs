// ============================================
// Tauri Application Entry Point
// SSE Bridge + Plugin Registration + Service Management
// ============================================

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{ipc::Channel, Manager, State};

// Desktop-only imports for service management
#[cfg(not(target_os = "android"))]
use std::process::{Command, Stdio};
#[cfg(not(target_os = "android"))]
use std::sync::atomic::AtomicBool;
#[cfg(not(target_os = "android"))]
use std::sync::Mutex;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

// ============================================
// SSE Connection State
// ============================================

/// 用于管理 SSE 连接的全局状态
/// 存储一个可选的 abort flag，用于取消正在进行的 SSE 连接
struct SseState {
    /// 每次连接分配一个递增 ID，用于区分不同连接
    current_id: AtomicU64,
    /// 当前活跃连接的 ID，0 表示无连接
    active_id: AtomicU64,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            current_id: AtomicU64::new(0),
            active_id: AtomicU64::new(0),
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
    state: State<'_, SseState>,
    args: SseConnectArgs,
    on_event: Channel<SseEvent>,
) -> Result<(), String> {
    // 分配连接 ID
    let conn_id = state.current_id.fetch_add(1, Ordering::SeqCst) + 1;
    // 设置为活跃连接
    state.active_id.store(conn_id, Ordering::SeqCst);

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
        // 检查是否被要求断开
        if state.active_id.load(Ordering::SeqCst) != conn_id {
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
async fn sse_disconnect(state: State<'_, SseState>) -> Result<(), String> {
    state.active_id.store(0, Ordering::SeqCst);
    Ok(())
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

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(SseState::default())
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

            Ok(())
        });

    // Desktop: 注册 service management commands + 窗口关闭拦截
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .manage(service::ServiceState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<service::ServiceState>();
                if state.we_started.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sse_connect,
            sse_disconnect,
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

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
