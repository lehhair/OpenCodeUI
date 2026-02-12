// ============================================
// Tauri Application Entry Point
// SSE Bridge + Plugin Registration
// ============================================

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{ipc::Channel, Manager, State};

// ============================================
// SSE Connection State
// ============================================

/// 用于管理 SSE 连接的全局状态
/// 存储一个可选的 abort flag，用于取消正在进行的 SSE 连接
struct SseState {
    /// 每次连接分配一个递增 ID，用于区分不同连接
    current_id: Mutex<u64>,
    /// 当前活跃连接的 ID，设为 None 表示要断开
    active_id: Mutex<Option<u64>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            current_id: Mutex::new(0),
            active_id: Mutex::new(None),
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
    Disconnected {
        reason: String,
    },
    /// SSE 连接出错
    Error {
        message: String,
    },
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
    let conn_id = {
        let mut id = state.current_id.lock().map_err(|e| e.to_string())?;
        *id += 1;
        let new_id = *id;
        // 设置为活跃连接
        let mut active = state.active_id.lock().map_err(|e| e.to_string())?;
        *active = Some(new_id);
        new_id
    };

    // 构建请求
    let client = reqwest::Client::new();
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
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    loop {
        // 检查是否被要求断开
        {
            let active = state.active_id.lock().map_err(|e| e.to_string())?;
            if *active != Some(conn_id) {
                let _ = on_event.send(SseEvent::Disconnected {
                    reason: "Disconnected by client".to_string(),
                });
                return Ok(());
            }
        }

        match stream.next().await {
            Some(Ok(chunk)) => {
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                // 按行解析 SSE 协议
                while let Some(newline_pos) = buffer.find('\n') {
                    let line = buffer[..newline_pos].to_string();
                    buffer = buffer[newline_pos + 1..].to_string();

                    let line = line.trim_end_matches('\r');

                    if line.starts_with("data:") {
                        let data = line[5..].trim();
                        if !data.is_empty() {
                            let _ = on_event.send(SseEvent::Message {
                                raw: data.to_string(),
                            });
                        }
                    }
                    // 忽略 event:, id:, retry: 等 SSE 字段
                    // 空行在 SSE 中是事件分隔符，我们已经按 data: 逐行发送了
                }
            }
            Some(Err(e)) => {
                let msg = format!("SSE stream error: {}", e);
                let _ = on_event.send(SseEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
            None => {
                // 流结束
                let _ = on_event.send(SseEvent::Disconnected {
                    reason: "Stream ended".to_string(),
                });
                return Ok(());
            }
        }
    }
}

/// 断开 SSE 连接
#[tauri::command]
async fn sse_disconnect(state: State<'_, SseState>) -> Result<(), String> {
    let mut active = state.active_id.lock().map_err(|e| e.to_string())?;
    *active = None;
    Ok(())
}

// ============================================
// App Entry Point
// ============================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        })
        .invoke_handler(tauri::generate_handler![sse_connect, sse_disconnect])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
