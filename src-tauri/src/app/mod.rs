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
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

#[cfg(windows)]
use tauri_plugin_decorum::WebviewWindowExt;

// Desktop-only imports for service management
#[cfg(not(target_os = "android"))]
use dir_state::OpenDirectoryState;
#[cfg(not(target_os = "android"))]
use std::sync::Arc;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

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

    #[cfg(windows)]
    let builder = builder.disable_drag_drop_handler();

    builder.visible(false).build()
}

#[cfg(not(target_os = "android"))]
fn finish_desktop_window_setup(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    let _ = window.create_overlay_titlebar();
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
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

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
                    // 窗口销毁时清理该窗口的所有桥接连接
                    let state = window.state::<BridgeState>();
                    state.disconnect_window(window.label());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_connect,
            commands::bridge::bridge_send,
            commands::bridge::bridge_disconnect,
            commands::utils::get_cli_directory,
            commands::utils::open_new_window,
            commands::utils::desktop_window_ready,
            commands::opencode::check_opencode_service,
            commands::opencode::start_opencode_service,
            commands::opencode::stop_opencode_service,
            commands::opencode::get_service_started_by_us,
            commands::opencode::confirm_close_app,
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
