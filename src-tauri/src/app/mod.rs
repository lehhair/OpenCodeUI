// ============================================
// Tauri Application Entry Point
// Unified Bridge + Plugin Registration + Service Management
// ============================================
mod bridge;
mod commands;
#[cfg(not(target_os = "android"))]
mod dir_state;
mod service;

use bridge::BridgeState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

// Desktop-only imports for service management
#[cfg(not(target_os = "android"))]
use dir_state::OpenDirectoryState;
#[cfg(not(target_os = "android"))]
use std::sync::Arc;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

#[cfg(not(target_os = "android"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedWindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}

#[cfg(not(target_os = "android"))]
fn window_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("window-state.json"))
}

#[cfg(not(target_os = "android"))]
fn load_window_state(app: &tauri::AppHandle) -> Option<SavedWindowState> {
    let path = window_state_path(app)?;
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

#[cfg(not(target_os = "android"))]
fn save_window_state(window: &tauri::Window) {
    if window.label() != "main" {
        return;
    }

    let is_fullscreen = window.is_fullscreen().unwrap_or(false);

    // 全屏时 outer_size / outer_position 返回的是整个屏幕的尺寸和 (0,0)，
    // 保存这些值会导致下次恢复时窗口大小/位置不正确。
    // 全屏状态下只更新 fullscreen 标记，保留之前保存的正常 size/position。
    if is_fullscreen {
        let app = window.app_handle();
        if let Some(path) = window_state_path(app) {
            if let Ok(existing) = std::fs::read_to_string(&path) {
                if let Ok(mut state) = serde_json::from_str::<SavedWindowState>(&existing) {
                    state.fullscreen = true;
                    if let Ok(data) = serde_json::to_string(&state) {
                        let _ = std::fs::write(path, data);
                    }
                    return;
                }
            }
            // 没有已保存的状态，只写 fullscreen 标记，size/position 用默认值
            let state = SavedWindowState {
                width: 800,
                height: 600,
                x: 100,
                y: 100,
                maximized: false,
                fullscreen: true,
            };
            if let Ok(data) = serde_json::to_string(&state) {
                let _ = std::fs::write(path, data);
            }
        }
        return;
    }

    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(position) = window.outer_position() else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);

    // 防御：窗口正在关闭时 outer_size 可能返回 0，不要用 0 覆盖已有的合法值
    if size.width == 0 || size.height == 0 {
        return;
    }

    let state = SavedWindowState {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized,
        fullscreen: false,
    };

    let app = window.app_handle();
    let Some(path) = window_state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_string(&state) {
        let _ = std::fs::write(path, data);
    }
}

#[cfg(not(target_os = "android"))]
fn restore_window_state(window: &tauri::WebviewWindow) {
    let app = window.app_handle();
    let Some(state) = load_window_state(app) else {
        return;
    };

    // 只在尺寸合理时恢复 size/position，防止保存了异常值导致窗口不可见
    if state.width >= 400 && state.height >= 300 {
        let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
    }
    // position 可能为负（多显示器场景），只在合理范围内恢复
    if state.x > -10000 && state.y > -10000 {
        let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
    }

    if state.maximized {
        let _ = window.maximize();
    }

    if state.fullscreen {
        let _ = window.set_fullscreen(true);
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

#[cfg(not(target_os = "android"))]
fn create_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("main window config missing");

    configure_desktop_window_builder(tauri::WebviewWindowBuilder::from_config(app, &config)?)
        .visible(false)
        .build()
}

#[cfg(target_os = "android")]
fn create_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("main window config missing");

    tauri::WebviewWindowBuilder::from_config(app, &config)?.build()
}

#[cfg(not(target_os = "android"))]
fn create_hidden_content_window(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let builder = configure_desktop_window_builder(tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App("index.html".into()),
    ))
    .title("OpenCode")
    .inner_size(800.0, 600.0);

    builder.visible(false).build()
}

/// macOS 红绿灯（关闭/最小化/最大化）相对窗口左上角的偏移。
/// 注意：这里通过 decorum 的 `set_traffic_lights_inset` 应用，其内部定位算法与
/// Tauri 原生 `trafficLightPosition` 不同，y 值需按与自定义标题栏的视觉对齐微调。
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_INSET: (f32, f32) = (12.0, 14.0);

/// 重新定位 macOS 红绿灯。
/// macOS 在退出全屏后会把红绿灯重置回系统默认位置，
/// 因此需要在退出全屏时重新应用偏移，保持与自定义标题栏垂直对齐。
#[cfg(target_os = "macos")]
fn reposition_traffic_lights(window: &tauri::WebviewWindow) {
    let (x, y) = TRAFFIC_LIGHT_INSET;
    let _ = window.set_traffic_lights_inset(x, y);
}

/// 记录每个窗口上一次的全屏状态（按 label），用于检测「退出全屏」这一跳变。
#[cfg(target_os = "macos")]
fn fullscreen_state() -> &'static std::sync::Mutex<std::collections::HashMap<String, bool>> {
    static STATE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, bool>>> =
        std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[cfg(not(target_os = "android"))]
fn finish_desktop_window_setup(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    let _ = window.set_decorations(false);

    // macOS：初始定位红绿灯，使其与自定义标题栏对齐
    #[cfg(target_os = "macos")]
    reposition_traffic_lights(window);
}

#[cfg(not(target_os = "android"))]
pub(crate) fn mark_window_ready<R: tauri::Runtime>(
    window: &tauri::Window<R>,
) -> Result<(), tauri::Error> {
    window.show()?;
    let _ = window.set_focus();

    Ok(())
}

/// 创建新窗口，可选地关联一个目录（多窗口支持）
#[cfg(not(target_os = "android"))]
pub(crate) fn create_new_window(app: &tauri::AppHandle, directory: Option<String>) {
    static WIN_COUNTER: AtomicU64 = AtomicU64::new(1);
    let label = format!("win-{}", WIN_COUNTER.fetch_add(1, Ordering::SeqCst));

    if let Some(ref dir) = directory {
        if let Some(state) = app.try_state::<OpenDirectoryState>() {
            state
                .pending()
                .pin()
                .insert(label.clone(), Arc::from(dir.clone()));
        }
    }

    match create_hidden_content_window(app, &label) {
        Ok(window) => {
            finish_desktop_window_setup(&window);

            log::info!(
                "Created new window '{}' for directory: {:?}",
                label,
                directory
            )
        }
        Err(e) => log::error!("Failed to create new window: {}", e),
    }
}

#[cfg(not(target_os = "android"))]
fn configure_desktop_window_builder<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    window_builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let window_builder = window_builder;

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 14.0));

    window_builder
}

pub fn run() {
    let builder = tauri::Builder::default().manage(BridgeState::default());

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_decorum::init());

    // Desktop: 注册 OpenDirectoryState + single-instance 插件（需在 setup 之前）
    #[cfg(not(target_os = "android"))]
    let builder =
        builder
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

            #[cfg(not(target_os = "android"))]
            {
                let main_window = create_main_window(&app.handle())?;
                finish_desktop_window_setup(&main_window);
                restore_window_state(&main_window);

                #[cfg(debug_assertions)]
                main_window.open_devtools();
            }

            #[cfg(target_os = "android")]
            {
                let _main_window = create_main_window(&app.handle())?;
            }

            // Desktop: 解析 CLI 参数，存入 pending state
            #[cfg(not(target_os = "android"))]
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(dir) = extract_directory_from_args(&args) {
                    log::info!("CLI directory argument: {}", dir);
                    if let Some(state) = app.try_state::<OpenDirectoryState>() {
                        state
                            .pending()
                            .pin()
                            .insert("main".to_string(), Arc::from(dir));
                    }
                }
            }

            // Windows: 注册 WSL 控制器状态（emit 需要持有 AppHandle，manage 在
            // setup 阶段完成），随后执行官方 initialize 对齐的启动逻辑
            #[cfg(target_os = "windows")]
            app.manage(commands::wsl_commands::WslState::new(app.handle().clone()));

            // Windows: 官方 initialize 对齐——恢复持久化配置 + 后台刷新 opencode
            // 检查 + 自动拉起全部服务器（wslServerIdsToStartOnInitialize 返回全部 id）
            #[cfg(target_os = "windows")]
            commands::wsl_commands::initialize_wsl(app.handle());

            Ok(())
        });

    // Desktop: 注册 service management commands + 窗口关闭拦截
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .manage(service::ServiceState::default())
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    save_window_state(window);

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
                tauri::WindowEvent::Resized(_) => {
                    // macOS：仅在「退出全屏」时重新对齐红绿灯。
                    // 普通缩放时 overlay 模式会自动把红绿灯锚定在左上角，无需干预；
                    // 若每帧都重算（setFrame 重设标题栏容器）反而会与 AppKit 的 resize
                    // 周期错相，导致拖拽卡顿。只有进出全屏时系统会重置位置。
                    #[cfg(target_os = "macos")]
                    if let Some(webview) = window.get_webview_window(window.label()) {
                        let is_fs = webview.is_fullscreen().unwrap_or(false);
                        let was_fs = fullscreen_state()
                            .lock()
                            .ok()
                            .map(|mut m| {
                                m.insert(window.label().to_string(), is_fs).unwrap_or(false)
                            })
                            .unwrap_or(false);
                        if was_fs && !is_fs {
                            reposition_traffic_lights(&webview);
                        }
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    save_window_state(window);

                    #[cfg(target_os = "macos")]
                    if let Ok(mut states) = fullscreen_state().lock() {
                        states.remove(window.label());
                    }

                    // 窗口销毁时清理该窗口的所有桥接连接
                    let state = window.state::<BridgeState>();
                    state.disconnect_window(window.label());
                }
                tauri::WindowEvent::DragDrop(event) => {
                    match event {
                        tauri::DragDropEvent::Enter { paths, position } => {
                            let paths: Vec<String> = paths
                                .into_iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            let _ = window.emit(
                                "file-drop-enter",
                                (paths, position.x, position.y),
                            );
                        }
                        tauri::DragDropEvent::Over { position } => {
                            let _ = window.emit("file-drop-over", (position.x, position.y));
                        }
                        tauri::DragDropEvent::Drop { paths, position } => {
                            let paths: Vec<String> = paths
                                .into_iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            let _ = window.emit(
                                "file-drop-drop",
                                (paths, position.x, position.y),
                            );
                        }
                        tauri::DragDropEvent::Leave => {
                            let _ = window.emit("file-drop-leave", ());
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_connect,
            commands::bridge::bridge_send,
            commands::bridge::bridge_disconnect,
            commands::utils::get_cli_directory,
            commands::utils::get_dropped_paths_info,
            commands::utils::open_new_window,
            commands::utils::desktop_window_ready,
            commands::opencode::check_opencode_service,
            commands::opencode::detect_opencode_binary,
            commands::opencode::start_opencode_service,
            commands::opencode::stop_opencode_service,
            commands::opencode::get_service_started_by_us,
            commands::opencode::confirm_close_app,
            // Windows: WSL 发行版管理命令（对齐官方 ipc.ts 的命令面：
            // getState / probeRuntime / refreshDistros / installWsl / installDistro /
            // probeAddable / installOpencode / openTerminal / add / remove / start）。
            // 注意：invoke_handler 是整体替换语义，WSL 命令必须合并在同一个
            // generate_handler! 列表里；如果另起一次 invoke_handler 会把
            // 上面的命令全部覆盖，导致前端窗口显示/服务管理等命令 404。
            #[cfg(target_os = "windows")]
            commands::wsl_commands::probe_wsl_runtime,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::refresh_wsl_distros,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::probe_wsl_addable,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::open_wsl_terminal,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::add_wsl_server,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::remove_wsl_server,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::start_wsl_server,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::get_wsl_state,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::install_wsl,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::install_wsl_distro,
            #[cfg(target_os = "windows")]
            commands::wsl_commands::install_wsl_opencode,
        ]);

    // Android: 注册 bridge commands
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::bridge::bridge_connect,
        commands::bridge::bridge_send,
        commands::bridge::bridge_disconnect,
    ]);

    // build + run 分开调用，以支持 macOS RunEvent::Opened
    let app = builder
        .build(tauri::generate_context!())
        .unwrap_or_else(|err| panic!("error while building tauri application: {err}"));

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
                                let pending = state.pending().pin();
                                let win_count = _app_handle.webview_windows().len();
                                if win_count <= 1 && !pending.contains_key("main") {
                                    pending.insert("main".to_string(), Arc::from(dir.clone()));
                                    let _ = _app_handle.emit("open-directory", dir);
                            } else {
                                create_new_window(_app_handle, Some(dir));
                            }
                        }
                    }
                }
            }
        }
    });
}
