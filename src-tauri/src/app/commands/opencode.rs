// ============================================
// OpenCode Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

use crate::app::service::ServiceState;
use reqwest::StatusCode;
use serde::Serialize;
use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    process::{Command, Stdio},
    sync::atomic::Ordering,
    time::Duration,
};
use tauri::State;

type HealthCheckFuture = Pin<Box<dyn Future<Output = bool> + Send>>;
type HealthCheckFn = dyn Fn() -> HealthCheckFuture + Send + Sync;
type SpawnFn = dyn Fn(&str, &HashMap<String, String>) -> Result<u32, String> + Send + Sync;

const START_READINESS_ATTEMPTS: usize = 30;
const START_READINESS_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartOpencodeServiceResult {
    pub spawned_now: bool,
    pub app_owned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseServiceAction {
    Stop { pid: Option<u32> },
    KeepRunning,
}

fn is_running_health_status(status: StatusCode) -> bool {
    status.is_success() || status == StatusCode::UNAUTHORIZED
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
            .map(|r| is_running_health_status(r.status()))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// 启动 opencode serve 进程
fn spawn_opencode_serve(
    binary_path: &str,
    env_vars: &HashMap<String, String>,
) -> Result<std::process::Child, String> {
    log::info!("Starting opencode serve with binary: {}", binary_path);
    if !env_vars.is_empty() {
        log::info!("Injecting {} environment variable(s)", env_vars.len());
    }

    let mut cmd = Command::new(binary_path);
    cmd.arg("serve").stdout(Stdio::null()).stderr(Stdio::null());

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

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to start '{}': {}. Check that the path is correct.",
            binary_path, e
        )
    })
}

async fn wait_for_service(
    health_check: &HealthCheckFn,
    readiness_attempts: usize,
    readiness_delay: Duration,
) -> bool {
    for _ in 0..readiness_attempts {
        tokio::time::sleep(readiness_delay).await;
        if health_check().await {
            return true;
        }
    }

    false
}

async fn start_opencode_service_inner(
    state: &ServiceState,
    url: &str,
    binary_path: &str,
    env_vars: &HashMap<String, String>,
    health_check: &HealthCheckFn,
    spawn: &SpawnFn,
    readiness_attempts: usize,
    readiness_delay: Duration,
) -> Result<StartOpencodeServiceResult, String> {
    let mut process = state.process.lock().await;
    let owned_pid = process.child_pid;
    let healthy = health_check().await;

    if healthy {
        if let Some(pid) = owned_pid {
            log::info!(
                "opencode service already running at {} with app-owned PID {}",
                url,
                pid
            );
            state.we_started.store(true, Ordering::SeqCst);
        } else {
            log::info!("opencode service already running externally at {}", url);
            state.we_started.store(false, Ordering::SeqCst);
        }

        return Ok(StartOpencodeServiceResult {
            spawned_now: false,
            app_owned: owned_pid.is_some(),
        });
    }

    if let Some(pid) = owned_pid {
        log::info!(
            "opencode service already started by app with PID {} but health is not ready yet",
            pid
        );
        state.we_started.store(true, Ordering::SeqCst);

        if wait_for_service(health_check, readiness_attempts, readiness_delay).await {
            log::info!("opencode service is ready at {}", url);
        } else {
            log::warn!(
                "opencode service still not healthy for existing app-owned PID {}",
                pid
            );
        }

        return Ok(StartOpencodeServiceResult {
            spawned_now: false,
            app_owned: true,
        });
    }

    let pid = spawn(binary_path, env_vars)?;

    if let Err(error) = state.register_spawned_pid_locked(&mut process, pid) {
        drop(process);
        log::warn!(
            "Failed to persist app-owned PID {} after spawn, stopping backend again: {}",
            pid,
            error
        );
        kill_process_by_pid(pid);
        return Err(error);
    }

    drop(process);

    log::info!("Started opencode serve, PID: {}", pid);

    if wait_for_service(health_check, readiness_attempts, readiness_delay).await {
        log::info!("opencode service is ready at {}", url);
    } else {
        log::warn!("opencode service started but health check not passing yet");
    }

    Ok(StartOpencodeServiceResult {
        spawned_now: true,
        app_owned: true,
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
        let signal_pid = match unix_signal_pid(pid) {
            Ok(signal_pid) => signal_pid,
            Err(error) => {
                log::warn!("Refusing to signal PID {}: {}", pid, error);
                return;
            }
        };

        let process_group_pid = signal_pid
            .checked_neg()
            .expect("validated signal pid should always be positive");

        if let Err(group_error) = send_sigterm(process_group_pid) {
            if group_error.raw_os_error() == Some(libc::ESRCH) {
                log::info!(
                    "Process group {} not found for PID {}, falling back to direct SIGTERM",
                    process_group_pid,
                    pid
                );

                if let Err(single_error) = send_sigterm(signal_pid) {
                    log::warn!(
                        "Failed to SIGTERM legacy PID {} after process-group ESRCH fallback: {}",
                        pid,
                        single_error
                    );
                }

                return;
            }

            log::warn!(
                "Failed to SIGTERM process group {} for PID {}: {}",
                process_group_pid,
                pid,
                group_error
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn unix_signal_pid(pid: u32) -> Result<libc::pid_t, &'static str> {
    if pid == 0 {
        return Err("PID 0 is reserved and would signal the current process group");
    }

    libc::pid_t::try_from(pid).map_err(|_| "PID does not fit into libc::pid_t")
}

#[cfg(not(target_os = "windows"))]
fn send_sigterm(target_pid: libc::pid_t) -> std::io::Result<()> {
    let result = unsafe { libc::kill(target_pid, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
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
    env_vars: HashMap<String, String>,
) -> Result<StartOpencodeServiceResult, String> {
    let health_url = url.clone();

    start_opencode_service_inner(
        state.inner(),
        &url,
        &binary_path,
        &env_vars,
        &move || {
            let health_url = health_url.clone();
            Box::pin(async move { is_service_running(&health_url).await })
        },
        &|spawn_binary_path, spawn_env_vars| {
            spawn_opencode_serve(spawn_binary_path, spawn_env_vars).map(|child| child.id())
        },
        START_READINESS_ATTEMPTS,
        START_READINESS_DELAY,
    )
    .await
}

async fn prepare_close_service_action(
    state: &ServiceState,
    stop_service: bool,
) -> CloseServiceAction {
    if stop_service {
        CloseServiceAction::Stop {
            pid: state.take_owned_pid_for_shutdown().await,
        }
    } else {
        CloseServiceAction::KeepRunning
    }
}

/// 停止 opencode serve
#[tauri::command]
pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
    let pid = state.take_owned_pid_for_shutdown().await;

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
    match prepare_close_service_action(state.inner(), stop_service).await {
        CloseServiceAction::Stop { pid } => {
            if let Some(pid) = pid {
                log::info!("Closing app and stopping opencode serve, PID: {}", pid);
                kill_process_by_pid(pid);
            }
        }
        CloseServiceAction::KeepRunning => {
            log::info!("Closing app, keeping opencode serve running");
        }
    }

    window.destroy().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        is_running_health_status, prepare_close_service_action, start_opencode_service_inner,
        CloseServiceAction, HealthCheckFuture, StartOpencodeServiceResult,
    };
    use crate::app::service::ServiceState;
    use reqwest::StatusCode;
    use std::{
        collections::HashMap,
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use tokio::sync::Barrier;

    #[cfg(unix)]
    use super::{kill_process_by_pid, unix_signal_pid};

    #[cfg(unix)]
    use std::{os::unix::process::CommandExt, process::{Child, Command, Stdio}, thread};

    const TEST_URL: &str = "http://127.0.0.1:4096";
    const TEST_BINARY_PATH: &str = "opencode";

    fn unique_marker_path(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "opencodeui-opencode-tests-{test_name}-{}-{timestamp}.json",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    fn unique_pid_path(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "opencodeui-opencode-tests-{test_name}-{}-{timestamp}.pid",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    fn spawn_waiting_shell(pid_file_path: &PathBuf, create_process_group: bool) -> Child {
        let mut command = Command::new("sh");
        command
            .args([
                "-c",
                "sleep 600 & child=$!; printf \"%s\" \"$child\" > \"$1\"; wait \"$child\"",
                "sh",
                pid_file_path
                    .to_str()
                    .expect("temporary pid file path should be valid UTF-8"),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if create_process_group {
            command.process_group(0);
        }

        command.spawn().expect("shell process should spawn")
    }

    #[cfg(unix)]
    fn read_pid_with_retry(pid_file_path: &PathBuf) -> u32 {
        for _ in 0..100 {
            if let Ok(contents) = fs::read_to_string(pid_file_path) {
                if let Ok(pid) = contents.trim().parse::<u32>() {
                    return pid;
                }
            }

            thread::sleep(Duration::from_millis(20));
        }

        panic!(
            "child pid file '{}' was not populated in time",
            pid_file_path.display()
        );
    }

    #[cfg(unix)]
    fn pid_exists(pid: u32) -> bool {
        let Ok(signal_pid) = unix_signal_pid(pid) else {
            return false;
        };

        let result = unsafe { libc::kill(signal_pid, 0) };
        if result == 0 {
            true
        } else {
            matches!(std::io::Error::last_os_error().raw_os_error(), Some(libc::EPERM))
        }
    }

    #[cfg(unix)]
    fn wait_for_process_exit(process: &mut Child) {
        for _ in 0..200 {
            if process
                .try_wait()
                .expect("waiting for process status should succeed")
                .is_some()
            {
                return;
            }

            thread::sleep(Duration::from_millis(20));
        }

        panic!("process {} did not exit before timeout", process.id());
    }

    #[cfg(unix)]
    fn wait_for_pid_gone(pid: u32) {
        for _ in 0..200 {
            if !pid_exists(pid) {
                return;
            }

            thread::sleep(Duration::from_millis(20));
        }

        panic!("pid {} still appears alive after timeout", pid);
    }

    #[test]
    fn unauthorized_health_response_counts_as_running() {
        assert!(is_running_health_status(StatusCode::OK));
        assert!(is_running_health_status(StatusCode::UNAUTHORIZED));
        assert!(!is_running_health_status(StatusCode::FORBIDDEN));
        assert!(!is_running_health_status(StatusCode::INTERNAL_SERVER_ERROR));
    }

    #[cfg(unix)]
    #[test]
    fn unix_process_group_shutdown_terminates_child_process() {
        let pid_file_path = unique_pid_path("unix-process-group-shutdown");
        let mut parent = spawn_waiting_shell(&pid_file_path, true);
        let parent_pid = parent.id();
        let child_pid = read_pid_with_retry(&pid_file_path);

        assert!(pid_exists(parent_pid));
        assert!(pid_exists(child_pid));

        kill_process_by_pid(parent_pid);

        wait_for_process_exit(&mut parent);
        wait_for_pid_gone(parent_pid);
        wait_for_pid_gone(child_pid);

        let _ = fs::remove_file(pid_file_path);
    }

    #[cfg(unix)]
    #[test]
    fn legacy_single_pid_kill_fallback_terminates_process_after_esrch() {
        let mut process = Command::new("sleep")
            .arg("600")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("sleep process should spawn");
        let pid = process.id();

        assert!(pid_exists(pid));

        kill_process_by_pid(pid);

        wait_for_process_exit(&mut process);
        wait_for_pid_gone(pid);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_zero_pid_before_signal() {
        assert_eq!(unix_signal_pid(0), Err("PID 0 is reserved and would signal the current process group"));
        assert_eq!(unix_signal_pid(u32::MAX), Err("PID does not fit into libc::pid_t"));
    }

    #[tokio::test]
    async fn concurrent_start_spawns_once() {
        let state = Arc::new(ServiceState::default());
        let barrier = Arc::new(Barrier::new(8));
        let health_call_count = Arc::new(AtomicUsize::new(0));
        let spawn_count = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let state = Arc::clone(&state);
                let barrier = Arc::clone(&barrier);
                let health_call_count = Arc::clone(&health_call_count);
                let spawn_count = Arc::clone(&spawn_count);

                tokio::spawn(async move {
                    let env_vars = HashMap::new();
                    let health_check = move || -> HealthCheckFuture {
                        let health_call_count = Arc::clone(&health_call_count);
                        Box::pin(async move {
                            let call_index = health_call_count.fetch_add(1, Ordering::SeqCst);
                            call_index >= 2
                        })
                    };
                    let spawn = move |_binary_path: &str, _env_vars: &HashMap<String, String>| {
                        let spawn_index = spawn_count.fetch_add(1, Ordering::SeqCst);
                        Ok(10_000 + spawn_index as u32)
                    };

                    barrier.wait().await;

                    start_opencode_service_inner(
                        state.as_ref(),
                        TEST_URL,
                        TEST_BINARY_PATH,
                        &env_vars,
                        &health_check,
                        &spawn,
                        4,
                        Duration::from_millis(1),
                    )
                    .await
                })
            })
            .collect();

        let mut spawned_results = 0;

        for handle in handles {
            let result = handle.await.expect("task should join").expect("start should succeed");
            if result.spawned_now {
                spawned_results += 1;
            }

            assert!(result.app_owned);
        }

        assert_eq!(spawned_results, 1);
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        assert_eq!(state.process.lock().await.child_pid, Some(10_000));
        assert!(state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn external_running_service_not_owned() {
        let state = ServiceState::default();
        let env_vars = HashMap::new();
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let health_check = || -> HealthCheckFuture { Box::pin(async { true }) };
        let spawn_count_for_closure = Arc::clone(&spawn_count);
        let spawn = move |_binary_path: &str, _env_vars: &HashMap<String, String>| {
            spawn_count_for_closure.fetch_add(1, Ordering::SeqCst);
            Ok(20_000)
        };

        let result = start_opencode_service_inner(
            &state,
            TEST_URL,
            TEST_BINARY_PATH,
            &env_vars,
            &health_check,
            &spawn,
            2,
            Duration::from_millis(1),
        )
        .await
        .expect("start should succeed");

        assert_eq!(
            result,
            StartOpencodeServiceResult {
                spawned_now: false,
                app_owned: false,
            }
        );
        assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
        assert_eq!(state.process.lock().await.child_pid, None);
        assert!(!state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn existing_owned_unhealthy_service_does_not_respawn() {
        let state = ServiceState::default();
        state.set_child_pid(30_000).await;

        let env_vars = HashMap::new();
        let health_call_count = Arc::new(AtomicUsize::new(0));
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let health_check = move || -> HealthCheckFuture {
            let health_call_count = Arc::clone(&health_call_count);
            Box::pin(async move {
                let call_index = health_call_count.fetch_add(1, Ordering::SeqCst);
                call_index >= 2
            })
        };
        let spawn_count_for_closure = Arc::clone(&spawn_count);
        let spawn = move |_binary_path: &str, _env_vars: &HashMap<String, String>| {
            spawn_count_for_closure.fetch_add(1, Ordering::SeqCst);
            Ok(30_001)
        };

        let result = start_opencode_service_inner(
            &state,
            TEST_URL,
            TEST_BINARY_PATH,
            &env_vars,
            &health_check,
            &spawn,
            4,
            Duration::from_millis(1),
        )
        .await
        .expect("start should succeed");

        assert_eq!(
            result,
            StartOpencodeServiceResult {
                spawned_now: false,
                app_owned: true,
            }
        );
        assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
        assert_eq!(state.process.lock().await.child_pid, Some(30_000));
        assert!(state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn spawn_timeout_preserves_pid_and_returns_true() {
        let state = ServiceState::default();
        let env_vars = HashMap::new();
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let health_check = || -> HealthCheckFuture { Box::pin(async { false }) };
        let spawn_count_for_closure = Arc::clone(&spawn_count);
        let spawn = move |_binary_path: &str, _env_vars: &HashMap<String, String>| {
            let spawn_index = spawn_count_for_closure.fetch_add(1, Ordering::SeqCst);
            Ok(40_000 + spawn_index as u32)
        };

        let result = start_opencode_service_inner(
            &state,
            TEST_URL,
            TEST_BINARY_PATH,
            &env_vars,
            &health_check,
            &spawn,
            2,
            Duration::from_millis(1),
        )
        .await
        .expect("start should succeed");

        assert_eq!(
            result,
            StartOpencodeServiceResult {
                spawned_now: true,
                app_owned: true,
            }
        );
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        assert_eq!(state.process.lock().await.child_pid, Some(40_000));
        assert!(state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn healthy_owned_service_reports_app_owned_without_respawn() {
        let state = ServiceState::default();
        state.set_child_pid(45_000).await;
        let env_vars = HashMap::new();
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let health_check = || -> HealthCheckFuture { Box::pin(async { true }) };
        let spawn_count_for_closure = Arc::clone(&spawn_count);
        let spawn = move |_binary_path: &str, _env_vars: &HashMap<String, String>| {
            spawn_count_for_closure.fetch_add(1, Ordering::SeqCst);
            Ok(45_001)
        };

        let result = start_opencode_service_inner(
            &state,
            TEST_URL,
            TEST_BINARY_PATH,
            &env_vars,
            &health_check,
            &spawn,
            2,
            Duration::from_millis(1),
        )
        .await
        .expect("start should succeed");

        assert_eq!(
            result,
            StartOpencodeServiceResult {
                spawned_now: false,
                app_owned: true,
            }
        );
        assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
        assert_eq!(state.process.lock().await.child_pid, Some(45_000));
        assert!(state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn reopened_keep_running_backend_remains_app_owned_for_final_close() {
        let marker_path = unique_marker_path("reopen-keep-running");
        let owned_pid = std::process::id();
        let initial_state = ServiceState::new(marker_path.clone());

        initial_state
            .register_spawned_pid(owned_pid)
            .await
            .expect("initial ownership marker should persist");

        let keep_running_action = prepare_close_service_action(&initial_state, false).await;
        assert_eq!(keep_running_action, CloseServiceAction::KeepRunning);
        assert_eq!(initial_state.process.lock().await.child_pid, Some(owned_pid));
        assert!(initial_state.we_started.load(Ordering::SeqCst));

        let reopened_state = ServiceState::new(marker_path.clone());
        assert_eq!(reopened_state.process.lock().await.child_pid, Some(owned_pid));
        assert!(reopened_state.we_started.load(Ordering::SeqCst));

        let env_vars = HashMap::new();
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let health_check = || -> HealthCheckFuture { Box::pin(async { true }) };
        let spawn_count_for_closure = Arc::clone(&spawn_count);
        let spawn = move |_binary_path: &str, _env_vars: &HashMap<String, String>| {
            spawn_count_for_closure.fetch_add(1, Ordering::SeqCst);
            Ok(owned_pid + 1)
        };

        let result = start_opencode_service_inner(
            &reopened_state,
            TEST_URL,
            TEST_BINARY_PATH,
            &env_vars,
            &health_check,
            &spawn,
            2,
            Duration::from_millis(1),
        )
        .await
        .expect("reopened start should succeed");

        assert_eq!(
            result,
            StartOpencodeServiceResult {
                spawned_now: false,
                app_owned: true,
            }
        );
        assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
        assert!(reopened_state.we_started.load(Ordering::SeqCst));

        let final_close_action = prepare_close_service_action(&reopened_state, true).await;
        assert_eq!(
            final_close_action,
            CloseServiceAction::Stop {
                pid: Some(owned_pid),
            }
        );
        assert!(!reopened_state.we_started.load(Ordering::SeqCst));
        assert!(!marker_path.exists());

        let _ = fs::remove_file(marker_path);
    }

    #[tokio::test]
    async fn stop_takes_owned_pid_once() {
        let state = ServiceState::default();
        state.set_child_pid(50_000).await;
        state.we_started.store(true, Ordering::SeqCst);

        let first_stop_pid = state.take_owned_pid_for_shutdown().await;
        let second_stop_pid = state.take_owned_pid_for_shutdown().await;

        assert_eq!(first_stop_pid, Some(50_000));
        assert_eq!(second_stop_pid, None);
        assert_eq!(state.process.lock().await.child_pid, None);
        assert!(!state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn confirm_close_keep_service_preserves_pid() {
        let state = ServiceState::default();
        state.set_child_pid(60_000).await;
        state.we_started.store(true, Ordering::SeqCst);

        let action = prepare_close_service_action(&state, false).await;

        assert_eq!(action, CloseServiceAction::KeepRunning);
        assert_eq!(state.process.lock().await.child_pid, Some(60_000));
        assert!(state.we_started.load(Ordering::SeqCst));
    }
}
