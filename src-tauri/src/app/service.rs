use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

use tokio::sync::Mutex;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ServiceProcess {
    pub child_pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct OwnedServiceMarker {
    pid: u32,
    process_key: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct OwnedServiceMarkerOnDisk {
    pid: u32,
    process_key: Option<String>,
    started_at: Option<String>,
}

/// 跟踪我们是否启动了 opencode serve 进程
pub struct ServiceState {
    /// App 自己持有的后端进程状态必须经过此 mutex 串行化，避免并发命令覆盖彼此的 PID。
    pub process: Mutex<ServiceProcess>,
    /// 是否由我们启动（用于关闭时判断是否需要询问）
    pub we_started: AtomicBool,
    ownership_marker_path: Option<PathBuf>,
}

impl ServiceState {
    pub fn new(ownership_marker_path: PathBuf) -> Self {
        let restored_pid = Self::restore_owned_pid(&ownership_marker_path);

        Self {
            process: Mutex::new(ServiceProcess {
                child_pid: restored_pid,
            }),
            we_started: AtomicBool::new(restored_pid.is_some()),
            ownership_marker_path: Some(ownership_marker_path),
        }
    }

    fn restore_owned_pid(ownership_marker_path: &Path) -> Option<u32> {
        Self::restore_owned_pid_with(
            ownership_marker_path,
            current_process_identity_key,
            current_legacy_process_started_at,
        )
    }

    fn restore_owned_pid_with<IdentityKeyFn, LegacyStartedAtFn>(
        ownership_marker_path: &Path,
        current_process_identity_key: IdentityKeyFn,
        current_legacy_process_started_at: LegacyStartedAtFn,
    ) -> Option<u32>
    where
        IdentityKeyFn: Fn(u32) -> Option<String>,
        LegacyStartedAtFn: Fn(u32) -> Option<String>,
    {
        let marker = match Self::load_ownership_marker(ownership_marker_path) {
            Some(marker) => marker,
            None => return None,
        };

        if let Some(stored_process_key) = marker.process_key.as_deref() {
            let Some(current_process_key) = current_process_identity_key(marker.pid) else {
                Self::clear_ownership_marker_file(ownership_marker_path);
                return None;
            };

            if stored_process_key == current_process_key {
                return Some(marker.pid);
            }

            Self::clear_ownership_marker_file(ownership_marker_path);
            return None;
        }

        if let Some(legacy_started_at) = marker.started_at.as_deref() {
            if current_legacy_process_started_at(marker.pid).as_deref() == Some(legacy_started_at) {
                if let Some(current_process_key) = current_process_identity_key(marker.pid) {
                    let migrated_marker = OwnedServiceMarker {
                        pid: marker.pid,
                        process_key: current_process_key,
                    };

                    if let Err(error) = Self::persist_ownership_marker_file(
                        ownership_marker_path,
                        &migrated_marker,
                    ) {
                        log::warn!(
                            "Failed to migrate legacy service ownership marker '{}': {}",
                            ownership_marker_path.display(),
                            error
                        );

                        Self::clear_ownership_marker_file(ownership_marker_path);
                        return None;
                    }
                }

                return Some(marker.pid);
            }

            // Legacy started_at markers depended on locale/timezone-sensitive output on Unix,
            // so drifted values are unrecoverable and must be cleared instead of guessed.
            Self::clear_ownership_marker_file(ownership_marker_path);
            return None;
        }

        Self::clear_ownership_marker_file(ownership_marker_path);
        None
    }

    fn load_ownership_marker(ownership_marker_path: &Path) -> Option<OwnedServiceMarkerOnDisk> {
        let marker_json = fs::read_to_string(ownership_marker_path).ok()?;
        serde_json::from_str(&marker_json).ok()
    }

    fn clear_ownership_marker_file(ownership_marker_path: &Path) {
        if let Err(error) = fs::remove_file(ownership_marker_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "Failed to clear service ownership marker '{}': {}",
                    ownership_marker_path.display(),
                    error
                );
            }
        }
    }

    fn persist_ownership_marker(&self, marker: &OwnedServiceMarker) -> Result<(), String> {
        let Some(ownership_marker_path) = self.ownership_marker_path.as_ref() else {
            return Ok(());
        };

        Self::persist_ownership_marker_file(ownership_marker_path, marker)
    }

    fn persist_ownership_marker_file(
        ownership_marker_path: &Path,
        marker: &OwnedServiceMarker,
    ) -> Result<(), String> {
        if let Some(parent) = ownership_marker_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create service ownership directory '{}': {}",
                    parent.display(),
                    error
                )
            })?;
        }

        let marker_json = serde_json::to_vec(marker)
            .map_err(|error| format!("Failed to serialize service ownership marker: {}", error))?;

        fs::write(ownership_marker_path, marker_json).map_err(|error| {
            format!(
                "Failed to persist service ownership marker '{}': {}",
                ownership_marker_path.display(),
                error
            )
        })
    }

    fn clear_ownership_marker(&self) {
        if let Some(ownership_marker_path) = self.ownership_marker_path.as_ref() {
            Self::clear_ownership_marker_file(ownership_marker_path);
        }
    }

    pub fn register_spawned_pid_locked(
        &self,
        process: &mut ServiceProcess,
        pid: u32,
    ) -> Result<(), String> {
        let marker = if self.ownership_marker_path.is_some() {
            Some(OwnedServiceMarker {
                pid,
                process_key: current_process_identity_key(pid).ok_or_else(|| {
                    format!("Failed to capture spawned process identity key for PID {}", pid)
                })?,
            })
        } else {
            None
        };

        process.child_pid = Some(pid);

        if let Some(marker) = marker.as_ref() {
            if let Err(error) = self.persist_ownership_marker(marker) {
                process.child_pid = None;
                self.we_started.store(false, Ordering::SeqCst);
                return Err(error);
            }
        }

        self.we_started.store(true, Ordering::SeqCst);
        Ok(())
    }

    #[cfg(test)]
    pub async fn register_spawned_pid(&self, pid: u32) -> Result<(), String> {
        let mut process = self.process.lock().await;
        self.register_spawned_pid_locked(&mut process, pid)
    }

    #[cfg(test)]
    pub async fn set_child_pid(&self, pid: u32) {
        self.process.lock().await.child_pid = Some(pid);
    }

    #[cfg(test)]
    pub async fn take_child_pid(&self) -> Option<u32> {
        self.process.lock().await.child_pid.take()
    }

    pub async fn take_owned_pid_for_shutdown(&self) -> Option<u32> {
        let mut process = self.process.lock().await;
        let pid = process.child_pid.take();
        self.we_started.store(false, Ordering::SeqCst);
        self.clear_ownership_marker();
        drop(process);
        pid
    }

    #[cfg(test)]
    pub async fn clear_child_pid(&self) {
        self.process.lock().await.child_pid = None;
    }
}

impl Default for ServiceState {
    fn default() -> Self {
        Self {
            process: Mutex::new(ServiceProcess::default()),
            we_started: AtomicBool::new(false),
            ownership_marker_path: None,
        }
    }
}

fn current_process_identity_key(pid: u32) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let started_at = current_windows_process_started_at_utc(pid)?;
        Some(format!("windows:{started_at}"))
    }

    #[cfg(target_os = "linux")]
    {
        current_linux_process_identity_key(pid)
    }

    #[cfg(target_os = "macos")]
    {
        current_macos_process_identity_key(pid)
    }

    #[cfg(all(unix, not(target_os = "linux"), not(target_os = "macos")))]
    {
        current_unix_legacy_process_started_at(pid)
    }
}

fn current_legacy_process_started_at(pid: u32) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        current_windows_process_started_at_utc(pid)
    }

    #[cfg(target_os = "linux")]
    {
        current_unix_legacy_process_started_at(pid)
    }

    #[cfg(target_os = "macos")]
    {
        current_unix_legacy_process_started_at(pid)
    }

    #[cfg(all(unix, not(target_os = "linux"), not(target_os = "macos")))]
    {
        current_unix_legacy_process_started_at(pid)
    }
}

#[cfg(target_os = "windows")]
fn current_windows_process_started_at_utc(pid: u32) -> Option<String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut command = Command::new("powershell");
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "$process = Get-Process -Id {} -ErrorAction SilentlyContinue; if ($process) {{ $process.StartTime.ToUniversalTime().ToString('o') }}",
                pid
            ),
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|started_at| !started_at.is_empty())
}

#[cfg(unix)]
fn current_unix_legacy_process_started_at(pid: u32) -> Option<String> {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|started_at| !started_at.is_empty())
}

#[cfg(target_os = "macos")]
fn current_macos_process_identity_key(pid: u32) -> Option<String> {
    let pid = i32::try_from(pid).ok()?;
    let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_PID, pid];
    let mut info = std::mem::MaybeUninit::<libc::kinfo_proc>::uninit();
    let mut info_len = std::mem::size_of::<libc::kinfo_proc>();

    let sysctl_result = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as libc::c_uint,
            info.as_mut_ptr().cast(),
            &mut info_len,
            std::ptr::null_mut(),
            0,
        )
    };

    if sysctl_result != 0 || info_len < std::mem::size_of::<libc::kinfo_proc>() {
        return None;
    }

    let start_time = unsafe { info.assume_init().kp_proc.p_un.p_starttime };
    format_macos_process_identity_key(start_time.tv_sec, start_time.tv_usec)
}

#[cfg(target_os = "macos")]
fn format_macos_process_identity_key(
    seconds: libc::time_t,
    microseconds: libc::suseconds_t,
) -> Option<String> {
    if seconds == 0 && microseconds == 0 {
        return None;
    }

    Some(format!("macos:{seconds}:{microseconds}"))
}

#[cfg(target_os = "linux")]
fn current_linux_process_identity_key(pid: u32) -> Option<String> {
    let boot_id = fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .ok()?
        .trim()
        .to_string();

    if boot_id.is_empty() {
        return None;
    }

    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let starttime_ticks = parse_linux_proc_stat_starttime(&stat)?;

    Some(format!("linux:{boot_id}:{starttime_ticks}"))
}

#[cfg(target_os = "linux")]
fn parse_linux_proc_stat_starttime(stat: &str) -> Option<&str> {
    let stat = stat.trim();
    let comm_end = stat.rfind(')')?;
    let remainder = stat.get(comm_end + 1..)?.trim_start();
    let fields: Vec<&str> = remainder.split_whitespace().collect();

    fields.get(19).copied()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::Ordering,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::ServiceState;

    fn missing_process_identity_key(_: u32) -> Option<String> {
        None
    }

    fn matching_legacy_started_at(_: u32) -> Option<String> {
        Some("legacy-start-time".to_string())
    }

    fn unique_marker_path(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "opencodeui-{test_name}-{}-{timestamp}.json",
            std::process::id()
        ))
    }

    #[tokio::test]
    async fn service_state_default() {
        let state = ServiceState::default();

        assert_eq!(state.process.lock().await.child_pid, None);
        assert!(!state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn service_state_take_pid() {
        let state = ServiceState::default();

        state.set_child_pid(1234).await;
        assert_eq!(state.process.lock().await.child_pid, Some(1234));

        assert_eq!(state.take_child_pid().await, Some(1234));
        assert_eq!(state.process.lock().await.child_pid, None);

        state.set_child_pid(5678).await;
        state.clear_child_pid().await;
        assert_eq!(state.take_child_pid().await, None);
        assert!(!state.we_started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn service_state_restores_owned_pid_from_marker() {
        let marker_path = unique_marker_path("restore-owned-pid-canonical");
        let pid = std::process::id();
        let state = ServiceState::new(marker_path.clone());

        state
            .register_spawned_pid(pid)
            .await
            .expect("marker should be written");

        let state = ServiceState::new(marker_path.clone());

        assert_eq!(state.process.lock().await.child_pid, Some(pid));
        assert!(state.we_started.load(Ordering::SeqCst));

        let _ = fs::remove_file(marker_path);
    }

    #[tokio::test]
    async fn service_state_discards_stale_marker() {
        let marker_path = unique_marker_path("discard-stale-canonical-marker");
        let pid = std::process::id();

        fs::write(
            &marker_path,
            format!("{{\"pid\":{pid},\"process_key\":\"stale-process-key\"}}"),
        )
            .expect("marker should be written");

        let state = ServiceState::new(marker_path.clone());

        assert_eq!(state.process.lock().await.child_pid, None);
        assert!(!state.we_started.load(Ordering::SeqCst));
        assert!(!marker_path.exists());
    }

    #[tokio::test]
    async fn register_spawned_pid_persists_marker() {
        let marker_path = unique_marker_path("persist-process-key-marker");
        let pid = std::process::id();
        let state = ServiceState::new(marker_path.clone());

        state
            .register_spawned_pid(pid)
            .await
            .expect("marker persistence should succeed");

        assert_eq!(state.process.lock().await.child_pid, Some(pid));
        assert!(state.we_started.load(Ordering::SeqCst));
        let marker = fs::read_to_string(&marker_path).expect("marker should exist");
        assert!(marker.contains(&format!("\"pid\":{pid}")));
        assert!(marker.contains("\"process_key\":\""));
        assert!(!marker.contains("\"started_at\":"));

        let taken_pid = state.take_owned_pid_for_shutdown().await;
        assert_eq!(taken_pid, Some(pid));
        assert!(!marker_path.exists());
    }

    #[tokio::test]
    async fn service_state_migrates_legacy_started_at_marker_to_canonical_process_key() {
        let marker_path = unique_marker_path("migrate-legacy-started-at-marker");
        let pid = std::process::id();
        let legacy_started_at = super::current_legacy_process_started_at(pid)
            .expect("legacy process identity should be readable for migration test");

        fs::write(
            &marker_path,
            format!("{{\"pid\":{pid},\"started_at\":\"{legacy_started_at}\"}}"),
        )
        .expect("legacy marker should be written");

        let state = ServiceState::new(marker_path.clone());

        assert_eq!(state.process.lock().await.child_pid, Some(pid));
        assert!(state.we_started.load(Ordering::SeqCst));

        let migrated_marker = fs::read_to_string(&marker_path).expect("marker should be rewritten");
        assert!(migrated_marker.contains(&format!("\"pid\":{pid}")));
        assert!(migrated_marker.contains("\"process_key\":\""));
        assert!(!migrated_marker.contains("\"started_at\":"));

        let _ = fs::remove_file(marker_path);
    }

    #[tokio::test]
    async fn service_state_clears_unrecoverable_legacy_started_at_marker_after_locale_drift() {
        let marker_path = unique_marker_path("clear-drifted-legacy-started-at-marker");
        let pid = std::process::id();

        fs::write(
            &marker_path,
            format!("{{\"pid\":{pid},\"started_at\":\"locale-drifted-start-time\"}}"),
        )
        .expect("legacy marker should be written");

        let state = ServiceState::new(marker_path.clone());

        assert_eq!(state.process.lock().await.child_pid, None);
        assert!(!state.we_started.load(Ordering::SeqCst));
        assert!(!marker_path.exists());
    }

    #[test]
    fn service_state_restores_legacy_marker_when_canonical_identity_is_unavailable_before_migration() {
        let marker_path = unique_marker_path("restore-legacy-marker-without-canonical-identity");
        let pid = std::process::id();

        fs::write(
            &marker_path,
            format!("{{\"pid\":{pid},\"started_at\":\"legacy-start-time\"}}"),
        )
        .expect("legacy marker should be written");

        let restored_pid = ServiceState::restore_owned_pid_with(
            &marker_path,
            missing_process_identity_key,
            matching_legacy_started_at,
        );

        assert_eq!(restored_pid, Some(pid));
        let legacy_marker = fs::read_to_string(&marker_path).expect("legacy marker should remain for future migration");
        assert!(legacy_marker.contains(&format!("\"pid\":{pid}")));
        assert!(legacy_marker.contains("\"started_at\":\"legacy-start-time\""));
        assert!(!legacy_marker.contains("\"process_key\":"));

        let _ = fs::remove_file(marker_path);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_linux_proc_stat_starttime_simple_comm() {
        let stat = "1234 (bash) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20 21 22";

        assert_eq!(super::parse_linux_proc_stat_starttime(stat), Some("987654"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_linux_proc_stat_starttime_comm_with_spaces() {
        let stat = "1234 (code helper) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 7654321 20 21 22";

        assert_eq!(super::parse_linux_proc_stat_starttime(stat), Some("7654321"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_linux_proc_stat_starttime_comm_with_parentheses() {
        let stat = "1234 (worker (beta) task) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 13579 20 21 22";

        assert_eq!(super::parse_linux_proc_stat_starttime(stat), Some("13579"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_current_process_identity_is_stable() {
        let pid = std::process::id();
        let first = super::current_linux_process_identity_key(pid)
            .expect("linux current process identity should be readable");
        let second = super::current_linux_process_identity_key(pid)
            .expect("linux current process identity should remain readable");

        assert!(first.starts_with("linux:"));
        assert_eq!(first, second);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn format_macos_process_identity_key() {
        assert_eq!(
            super::format_macos_process_identity_key(1_715_138_925, 42),
            Some("macos:1715138925:42".to_string())
        );
        assert_eq!(super::format_macos_process_identity_key(0, 0), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_current_process_identity_is_stable() {
        let pid = std::process::id();
        let first = super::current_macos_process_identity_key(pid)
            .expect("macOS current process identity should be readable");
        let second = super::current_macos_process_identity_key(pid)
            .expect("macOS current process identity should remain readable");

        assert!(first.starts_with("macos:"));
        assert_eq!(first, second);
    }
}
