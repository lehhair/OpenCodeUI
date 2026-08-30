use std::collections::HashMap;
use std::sync::Mutex;

use tauri::command;
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use super::wsl_runtime;
use super::wsl_types::*;

// ============================================
// WSL 控制器 —— 对齐官方 packages/desktop/src/main/wsl/{servers,sidecar,startup,policy}.ts
//
// 架构映射：官方 Electron main 进程的 controller + 事件订阅，在 Tauri 中
// 映射为 managed state + app.emit("wsl-state") 全量状态推送；前端订阅事件
// 维护单一状态树（对齐官方 context.tsx 的 useQuery + subscribe 模式）。
// ============================================

/// 持久化文件名
const WSL_SERVERS_FILE: &str = "wsl-servers.json";

/// 仅序列化服务器配置（不含运行时状态），官方同款 `{ servers: [...] }` 结构
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedServers {
    servers: Vec<WslServerConfig>,
}

/// 从磁盘加载已保存的服务器配置
fn load_persisted_servers(app: &AppHandle) -> Vec<WslServerConfig> {
    let Some(dir) = app.path().app_config_dir().ok() else {
        return Vec::new();
    };
    let path = dir.join(WSL_SERVERS_FILE);
    let Ok(data) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<PersistedServers>(&data)
        .map(|p| p.servers)
        .unwrap_or_default()
}

/// 将服务器配置持久化到磁盘
fn persist_servers(app: &AppHandle, configs: &[WslServerConfig]) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let data = PersistedServers {
        servers: configs.to_vec(),
    };
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    let path = dir.join(WSL_SERVERS_FILE);
    std::fs::write(&path, json).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(())
}

/// 持久化记录归一化（官方 normalizePersistedServer）：兼容缺 id 的旧记录
fn normalize_persisted_server(value: WslServerConfig) -> Option<WslServerConfig> {
    if value.distro.is_empty() {
        return None;
    }
    if value.id.is_empty() {
        return Some(WslServerConfig {
            id: wsl_server_id_for_distro(&value.distro),
            distro: value.distro,
        });
    }
    Some(value)
}

/// 运行中的 sidecar 句柄：cancel token 触发后监督任务杀掉子进程。
/// token 是"所有权凭证"——stop/remove 会先从 map 移除再 cancel，
/// 监督任务用 attempt 核对 map 里的句柄是否仍是自己，不是则保持静默。
struct SidecarHandle {
    token: CancellationToken,
    attempt: u64,
}

/// job 凭证：token + 代数（endJob 核对仍是自己开启的 job 才清空）
struct JobHandle {
    token: CancellationToken,
    generation: u64,
}

impl std::ops::Deref for JobHandle {
    type Target = CancellationToken;
    fn deref(&self) -> &Self::Target {
        &self.token
    }
}

// ============================================
// 全局状态（controller）
// ============================================

/// 全局 WSL 状态（通过 Tauri managed state 共享）
pub struct WslState {
    app: AppHandle,
    pub state: Mutex<WslServersState>,
    /// 每台服务器的 sidecar 句柄（key 为 server id）
    sidecars: Mutex<HashMap<String, SidecarHandle>>,
    /// 每个 server id 的启动尝试计数（官方 startAttempts）：
    /// stop/remove 会使计数自增，旧的启动流程在关键节点校验 attempt，
    /// 避免旧流程的 Ready/Failed 覆盖新流程的状态
    pub start_attempts: Mutex<HashMap<String, u64>>,
    /// 当前 job 的取消令牌：beginJob 时取消上一个 job 的在途命令
    /// （官方 beginJob 的 AbortController 语义）
    job_token: Mutex<Option<JobHandle>>,
    /// job 代数计数器
    job_generation: std::sync::atomic::AtomicU64,
}

impl WslState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            state: Mutex::new(WslServersState::default()),
            sidecars: Mutex::new(HashMap::new()),
            start_attempts: Mutex::new(HashMap::new()),
            job_token: Mutex::new(None),
            job_generation: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// 全量推送当前状态到前端（官方 emit 的 {type:"state", state}）
    fn emit(&self) {
        if let Ok(s) = self.state.lock() {
            let _ = self.app.emit("wsl-state", s.clone());
        }
    }

    /// 局部更新状态并推送（官方 setState）
    fn set_state(&self, update: impl FnOnce(&mut WslServersState)) {
        if let Ok(mut s) = self.state.lock() {
            update(&mut s);
        }
        self.emit();
    }

    /// 开启一个新 job：取消上一个 job 的在途命令（官方 beginJob）
    fn begin_job(&self, job: WslJob) -> JobHandle {
        let token = CancellationToken::new();
        let generation = self
            .job_generation
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if let Ok(mut slot) = self.job_token.lock() {
            if let Some(prev) = slot.take() {
                prev.token.cancel();
            }
            *slot = Some(JobHandle {
                token: token.clone(),
                generation,
            });
        }
        self.set_state(|s| s.job = Some(job));
        JobHandle { token, generation }
    }

    /// 结束 job（官方 endJob：仅当仍是自己开启的 job 时清空。
    /// 被 newer job 抢占的旧 job 收尾时不得清掉新 job 的在途标记，
    /// 否则前端会短暂误判"无任务在跑"而放行按钮）
    fn end_job(&self, handle: &JobHandle) {
        let owned = match self.job_token.lock() {
            Ok(mut slot) => {
                let owned = slot.as_ref().is_some_and(|c| c.generation == handle.generation);
                if owned {
                    *slot = None;
                }
                owned
            }
            Err(_) => false,
        };
        if owned {
            self.set_state(|s| s.job = None);
        }
    }

    /// 从磁盘恢复已保存的服务器配置到内存状态（官方 refreshFromStore）
    pub fn restore_persisted(&self) {
        let configs: Vec<WslServerConfig> = load_persisted_servers(&self.app)
            .into_iter()
            .filter_map(normalize_persisted_server)
            .collect();
        if configs.is_empty() {
            return;
        }
        self.set_state(|s| {
            s.servers = configs
                .into_iter()
                .map(|config| WslServerItem {
                    config,
                    runtime: WslServerRuntime::Stopped,
                })
                .collect();
        });
    }

    /// 当前服务器 id 列表（应用启动时自动拉起用）
    pub fn persisted_server_ids(&self) -> Vec<String> {
        match self.state.lock() {
            Ok(s) => s.servers.iter().map(|item| item.config.id.clone()).collect(),
            Err(_) => Vec::new(),
        }
    }
}

// ============================================
// 内部实现 —— opencode 检查（官方 opencodeCheck 三分支结果语义）
// ============================================

/// 组装 opencode 检查结果：!resolvedPath → 未安装；!version → 无法运行；
/// 命令级失败由调用方以 Err 传播（不写入检查记录）
async fn check_opencode(
    distro: &str,
    token: Option<&CancellationToken>,
) -> Result<WslOpencodeCheck, String> {
    let resolved = wsl_runtime::resolve_opencode(distro, token).await?;
    let version = match &resolved {
        Some(path) => wsl_runtime::read_command_version(path, distro, token).await?,
        None => None,
    };

    let error = if resolved.is_none() {
        Some(format!("opencode is not installed in distribution '{}'", distro))
    } else if version.is_none() {
        Some("opencode is installed but could not be executed".to_string())
    } else {
        None
    };

    Ok(WslOpencodeCheck {
        distro: distro.to_string(),
        resolved_path: resolved,
        version,
        expected_version: None,
        matches_desktop: None,
        error,
    })
}

/// 探测结果是否"能力齐备"（官方 distroProbeReady）
fn distro_probe_ready(probe: Option<&WslDistroProbe>) -> bool {
    match probe {
        Some(p) => p.can_execute && p.has_bash && p.has_curl,
        None => false,
    }
}

/// 批量探测 + opencode 检查（官方 probeAddableDistros 增量语义）：
/// 只探没有记录的 distro；只对能力齐备且没有检查记录的 distro 查 opencode。
/// 任一命令级失败则整体失败、不写入任何记录（下轮自动重试）。
async fn probe_addable_distros(state: &WslState, distros: &[String], token: &CancellationToken) -> Result<(), String> {
    let unique: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        distros
            .iter()
            .filter(|d| seen.insert((*d).clone()))
            .cloned()
            .collect()
    };

    // 1) 探测没有记录的 distro
    let to_probe: Vec<String> = {
        let s = state.state.lock().map_err(|e| e.to_string())?;
        unique
            .iter()
            .filter(|d| !s.distro_probes.contains_key(*d))
            .cloned()
            .collect()
    };
    if !to_probe.is_empty() {
        let probes = futures_util::future::join_all(to_probe.iter().map(|d| wsl_runtime::probe_distro(d, Some(token))))
            .await
            .into_iter()
            .collect::<Result<Vec<_>, String>>()?;
        state.set_state(|s| {
            for probe in probes {
                s.distro_probes.insert(probe.name.clone(), probe);
            }
        });
    }

    // 2) 能力齐备且没有检查记录的 distro 查 opencode
    let to_check: Vec<String> = {
        let s = state.state.lock().map_err(|e| e.to_string())?;
        unique
            .iter()
            .filter(|d| distro_probe_ready(s.distro_probes.get(*d)))
            .filter(|d| !s.opencode_checks.contains_key(*d))
            .cloned()
            .collect()
    };
    if !to_check.is_empty() {
        let checks = futures_util::future::join_all(to_check.iter().map(|d| check_opencode(d, Some(token))))
            .await
            .into_iter()
            .collect::<Result<Vec<_>, String>>()?;
        state.set_state(|s| {
            for check in checks {
                s.opencode_checks.insert(check.distro.clone(), check);
            }
        });
    }

    Ok(())
}

// ============================================
// Tauri Commands — 探测与列表
// ============================================

/// 探测 WSL 运行时（官方 probeRuntime）
#[command]
pub async fn probe_wsl_runtime(state: tauri::State<'_, WslState>) -> Result<(), String> {
    let token = state.begin_job(WslJob::Runtime {
        started_at: now_ms(),
    });
    let result = wsl_runtime::probe_wsl_runtime(Some(&token)).await;
    match result {
        Ok(runtime) => {
            state.set_state(|s| {
                s.pending_restart = s.pending_restart && !runtime.available;
                s.runtime = Some(runtime);
            });
            state.end_job(&token);
            Ok(())
        }
        Err(e) => {
            state.end_job(&token);
            Err(e)
        }
    }
}

/// 刷新发行版列表（官方 refreshDistros）。
/// 同时清掉 can_execute=false 的探测记录（checkAgain 语义）：
/// 探测失败可能是 WSL 冷启动等瞬时问题，重试应重新探测而不是永远卡在
/// "打开一次完成设置"的提示上。
#[command]
pub async fn refresh_wsl_distros(state: tauri::State<'_, WslState>) -> Result<(), String> {
    let token = state.begin_job(WslJob::Distros {
        started_at: now_ms(),
    });
    let result = tokio::join!(
        wsl_runtime::list_installed_distros(Some(&token)),
        wsl_runtime::list_online_distros(Some(&token))
    );
    match result {
        (Ok(installed), Ok(online)) => {
            state.set_state(|s| {
                s.installed = installed;
                s.online = online;
                // checkAgain 重新探测失败过的 distro
                s.distro_probes.retain(|_, p| p.can_execute);
            });
            state.end_job(&token);
            Ok(())
        }
        (Err(e), _) | (_, Err(e)) => {
            state.end_job(&token);
            Err(e)
        }
    }
}

/// 批量探测可添加的发行版（官方 probeAddable，前端 probe 计划驱动）
#[command]
pub async fn probe_wsl_addable(distros: Vec<String>, state: tauri::State<'_, WslState>) -> Result<(), String> {
    if distros.is_empty() {
        return Ok(());
    }
    let token = state.begin_job(WslJob::ProbeAddable {
        distros: distros.clone(),
        started_at: now_ms(),
    });
    let result = probe_addable_distros(&state, &distros, &token).await;
    state.end_job(&token);
    result
}

/// 打开 WSL 终端（官方 openTerminal）
#[command]
pub fn open_wsl_terminal(distro: Option<String>) -> Result<(), String> {
    wsl_runtime::open_wsl_terminal(distro.as_deref())
}

// ============================================
// Tauri Commands — 安装类
// ============================================

/// 从执行结果提取错误信息（stderr 优先，压缩为非空行）
fn result_error(result: &wsl_runtime::WslCommandResult, fallback: &str) -> String {
    let raw = if result.stderr.is_empty() {
        &result.stdout
    } else {
        &result.stderr
    };
    let message = wsl_runtime::summarize(raw);
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

/// 安装 WSL 运行时（触发 UAC 提权，官方 installWsl：成功后探测，仍不可用 → 待重启）
#[command]
pub async fn install_wsl(state: tauri::State<'_, WslState>) -> Result<(), String> {
    let token = state.begin_job(WslJob::InstallWsl {
        started_at: now_ms(),
    });
    let result = wsl_runtime::install_wsl_runtime(Some(&token)).await;
    match result {
        Ok(r) if r.code == Some(0) => {
            // 探测失败也必须收尾 job：`?` 提前返回会跳过 end_job，
            // job 永久悬挂会让所有按钮一直处于禁用状态
            match wsl_runtime::probe_wsl_runtime(Some(&token)).await {
                Ok(runtime) => {
                    state.set_state(|s| {
                        s.pending_restart = !runtime.available;
                        s.runtime = Some(runtime);
                    });
                    state.end_job(&token);
                    Ok(())
                }
                Err(e) => {
                    state.end_job(&token);
                    Err(e)
                }
            }
        }
        Ok(r) => {
            state.end_job(&token);
            Err(result_error(&r, "WSL installation failed"))
        }
        Err(e) => {
            state.end_job(&token);
            Err(e)
        }
    }
}

/// 安装指定发行版（官方 installDistro：成功后刷新列表并探测该发行版）
#[command]
pub async fn install_wsl_distro(name: String, state: tauri::State<'_, WslState>) -> Result<(), String> {
    let token = state.begin_job(WslJob::InstallDistro {
        distro: name.clone(),
        started_at: now_ms(),
    });
    let result = wsl_runtime::install_wsl_distro(&name, Some(&token)).await;
    match result {
        Ok(r) if r.code == Some(0) => {
            let installed = wsl_runtime::list_installed_distros(Some(&token)).await;
            let online = wsl_runtime::list_online_distros(Some(&token)).await;
            let probe = wsl_runtime::probe_distro(&name, Some(&token)).await;
            match (installed, online, probe) {
                (Ok(installed), Ok(online), Ok(probe)) => {
                    state.set_state(|s| {
                        s.installed = installed;
                        s.online = online;
                        s.distro_probes.insert(name.clone(), probe);
                    });
                    state.end_job(&token);
                    Ok(())
                }
                (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => {
                    state.end_job(&token);
                    Err(e)
                }
            }
        }
        Ok(r) => {
            state.end_job(&token);
            Err(result_error(&r, "WSL distribution installation failed"))
        }
        Err(e) => {
            state.end_job(&token);
            Err(e)
        }
    }
}

/// 在发行版中安装 opencode（官方 installOpencode：成功后刷新检查并重启该
/// 发行版已存在的服务器，让新安装生效）
#[command]
pub async fn install_wsl_opencode(distro: String, state: tauri::State<'_, WslState>) -> Result<(), String> {
    let token = state.begin_job(WslJob::InstallOpencode {
        distro: distro.clone(),
        started_at: now_ms(),
    });
    let result = wsl_runtime::install_wsl_opencode(&distro, Some(&token)).await;
    match result {
        Ok(r) if r.code == Some(0) => {
            let check = check_opencode(&distro, Some(&token)).await;
            match check {
                Ok(check) => {
                    state.set_state(|s| {
                        s.opencode_checks.insert(distro.clone(), check);
                    });
                    state.end_job(&token);
                    // 重启该发行版的服务器（官方 wslServerIdToRestart → startServer）
                    let id = {
                        let s = state.state.lock().map_err(|e| e.to_string())?;
                        s.servers
                            .iter()
                            .find(|item| item.config.distro == distro)
                            .map(|item| item.config.id.clone())
                    };
                    if let Some(id) = id {
                        start_server_internal(&state.app, &id);
                    }
                    Ok(())
                }
                Err(e) => {
                    state.end_job(&token);
                    Err(e)
                }
            }
        }
        Ok(r) => {
            state.end_job(&token);
            Err(result_error(&r, "opencode installation failed"))
        }
        Err(e) => {
            state.end_job(&token);
            Err(e)
        }
    }
}

// ============================================
// sidecar 启动（官方 spawnWslSidecar + startServer）
// ============================================

/// 分配一个当前空闲的本地端口（官方 allocatePort：绑定 :0 由系统分配后立即释放）
fn allocate_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .map(|l| l.local_addr().map(|a| a.port()).map_err(|e| e.to_string()))
        .map_err(|e| e.to_string())?
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 收集 sidecar 输出流的行到尾部缓冲（保留 12 行，[stream] 前缀，官方 forwardLines）
async fn collect_recent_lines(
    pipe: &mut (impl tokio::io::AsyncRead + Unpin),
    stream: &str,
    recent: std::sync::Arc<Mutex<Vec<String>>>,
) {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut lines = BufReader::new(pipe).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(mut buf) = recent.lock() {
            buf.push(format!("[{}] {}", stream, line));
            if buf.len() > 12 {
                buf.remove(0);
            }
        }
    }
}

/// 更新指定服务器的运行时状态并推送
fn set_runtime(state: &WslState, id: &str, runtime: WslServerRuntime) {
    state.set_state(|s| {
        if let Some(item) = s.servers.iter_mut().find(|item| item.config.id == id) {
            item.runtime = runtime;
        }
    });
}

/// Ready 后后台刷新 opencode 检查（官方 refreshOpencodeCheckBackground）：
/// 仅当该服务器仍存在时写入结果
fn refresh_opencode_check_background(app: &AppHandle, id: String, distro: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<WslState>();
        match check_opencode(&distro, None).await {
            Ok(check) => {
                let exists = state
                    .state
                    .lock()
                    .map(|s| s.servers.iter().any(|item| item.config.id == id))
                    .unwrap_or(false);
                if exists {
                    state.set_state(|s| {
                        s.opencode_checks.insert(distro.clone(), check);
                    });
                }
            }
            Err(_) => {
                // 后台刷新失败不影响运行状态（官方仅记日志）
            }
        }
    });
}

/// 启动服务器：立即返回，后台执行启动流程，状态经事件推送更新
/// （官方 addServer/startServer 的 void startServer(id) 语义）
fn start_server_internal(app: &AppHandle, id: &str) {
    let state = app.state::<WslState>();
    let attempt = match state.start_attempts.lock() {
        Ok(mut attempts) => {
            let next = attempts.get(id).copied().unwrap_or(0) + 1;
            attempts.insert(id.to_string(), next);
            next
        }
        Err(_) => return,
    };
    let app = app.clone();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        run_start_server(&app, &id, attempt).await;
    });
}

fn is_current_attempt(app: &AppHandle, id: &str, attempt: u64) -> bool {
    let state = app.state::<WslState>();
    let attempt_ok = state
        .start_attempts
        .lock()
        .map(|m| m.get(id) == Some(&attempt))
        .unwrap_or(false);
    let server_ok = state
        .state
        .lock()
        .map(|s| s.servers.iter().any(|item| item.config.id == id))
        .unwrap_or(false);
    attempt_ok && server_ok
}

/// 启动单个 WSL 服务器（官方 spawnWslSidecar + startServer 合并）：
///
/// - stdin 下发 `bash -se` 启动脚本（PATH 清洗 /mnt/*、WSLENV=、禁 filewatcher、
///   OPENCODE_CLIENT=desktop、随机密码注入、--print-logs --log-level WARN）
/// - 健康检查 100ms 轮询 / 30s 超时，Basic 鉴权（官方 checkHealth 同款）
/// - Promise.race([health, exit, timeout]) 语义：进程提前退出附带最近 12 行输出
/// - Ready 后监督进程退出 → failed（官方 listener.onExit）
#[allow(clippy::too_many_lines)]
async fn run_start_server(app: &AppHandle, id: &str, attempt: u64) {
    let state = app.state::<WslState>();
    let is_current = || is_current_attempt(app, id, attempt);

    // 取配置（config 无端口字段，端口动态分配）
    let distro = {
        let s = match state.state.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        let Some(item) = s.servers.iter().find(|item| item.config.id == id) else {
            return;
        };
        item.config.distro.clone()
    };

    // 先清掉残留的旧 sidecar（官方 startServer 先 stopServerInternal）
    stop_sidecar_internal(&state, id).await;
    if !is_current() {
        return;
    }
    set_runtime(&state, id, WslServerRuntime::Starting);

    // 在 WSL 中解析 opencode 路径（官方 resolveWslOpencode，找不到即失败）
    let opencode_path = match wsl_runtime::resolve_opencode(&distro, None).await {
        Ok(Some(path)) => path,
        Ok(None) => {
            let message = format!("opencode is not installed in distribution '{}'", distro);
            if is_current() {
                set_runtime(&state, id, WslServerRuntime::Failed { message });
            }
            return;
        }
        Err(e) => {
            if is_current() {
                set_runtime(&state, id, WslServerRuntime::Failed { message: e });
            }
            return;
        }
    };
    if !is_current() {
        return;
    }

    // 动态分配端口 + 随机密码（官方 allocatePort + randomUUID + "opencode"）
    let port = match allocate_port() {
        Ok(p) => p,
        Err(e) => {
            if is_current() {
                set_runtime(&state, id, WslServerRuntime::Failed { message: e });
            }
            return;
        }
    };
    let password = uuid::Uuid::new_v4().to_string();
    let username = "opencode";

    // 启动脚本：官方同款逐行还原
    let script = [
        "set -euo pipefail".to_string(),
        r#"cd "$HOME" || cd /"#.to_string(),
        // 剔除 PATH 中的 Windows 盘符挂载路径（/mnt/...），防止 Windows 侧同名二进制抢先
        r#"PATH=$(awk -v RS=: -v ORS=: '$0 !~ /^\/mnt\//' <<<"$PATH" | sed "s/:$//")"#.to_string(),
        "export PATH".to_string(),
        "export WSLENV=".to_string(),
        "export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true".to_string(),
        "export OPENCODE_CLIENT=desktop".to_string(),
        format!("export OPENCODE_SERVER_USERNAME={}", wsl_runtime::shell_escape(username)),
        format!("export OPENCODE_SERVER_PASSWORD={}", wsl_runtime::shell_escape(&password)),
        r#"export XDG_STATE_HOME="$HOME/.local/state""#.to_string(),
        // 打包版 WARN / 开发版 INFO（官方 app.isPackaged 分支）
        format!(
            "exec {} --print-logs --log-level {} serve --hostname 0.0.0.0 --port {}",
            wsl_runtime::shell_escape(&opencode_path),
            if cfg!(debug_assertions) { "INFO" } else { "WARN" },
            port
        ),
    ]
    .join("\n");

    let mut cmd = tokio::process::Command::new("wsl");
    cmd.args(["-d", &distro, "--", "bash", "-se"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        // tokio::process::Command 在 Windows 上自带 creation_flags（GUI 下避免闪黑框）
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            if is_current() {
                set_runtime(
                    &state,
                    id,
                    WslServerRuntime::Failed {
                        message: format!("Failed to start WSL process: {}", e),
                    },
                );
            }
            return;
        }
    };

    // 下发启动脚本后立即关闭 stdin，让 bash 开始执行（官方 child.stdin.end(script)）
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        let _ = stdin.write_all(script.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    // 后台收集最近输出（保留尾部 12 行），进程提前退出时附带用于定位
    // （官方 forwardLines：按行收集，[stdout]/[stderr] 前缀）
    let recent: std::sync::Arc<Mutex<Vec<String>>> = std::sync::Arc::default();
    {
        let Some(mut pipe) = child.stdout.take() else {
            return;
        };
        let recent = recent.clone();
        tauri::async_runtime::spawn(async move {
            collect_recent_lines(&mut pipe, "stdout", recent).await;
        });
    }
    {
        let Some(mut pipe) = child.stderr.take() else {
            return;
        };
        let recent = recent.clone();
        tauri::async_runtime::spawn(async move {
            collect_recent_lines(&mut pipe, "stderr", recent).await;
        });
    }

    // 注册 sidecar 句柄（stop/remove 通过 cancel token 杀进程）
    let token = CancellationToken::new();
    if let Ok(mut sidecars) = state.sidecars.lock() {
        sidecars.insert(
            id.to_string(),
            SidecarHandle {
                token: token.clone(),
                attempt,
            },
        );
    }

    // Promise.race([health, exit, timedOut])：健康检查 / 提前退出 / 30s 超时
    let url = format!("http://127.0.0.1:{}", port);
    let health_timeout_ms: u64 = 30_000;
    let mut ready = false;
    let mut failure: Option<String> = None;
    while !ready && failure.is_none() {
        // attempt 失效（stop/remove/restart）：终止并静默退出
        if !is_current() {
            let _ = child.kill().await;
            cleanup_sidecar(&state, id);
            return;
        }
        // 进程在就绪前退出：附带最近输出（官方 startupFailure serverExitedBeforeHealthy）
        if let Ok(Some(status)) = child.try_wait() {
            let tail = recent.lock().map(|buf| buf.join("\n")).unwrap_or_default();
            let suffix = if tail.is_empty() {
                String::new()
            } else {
                format!("\n{}", tail)
            };
            failure = Some(format!(
                "opencode serve exited before becoming healthy (exit code {}).{}",
                status.code().map(|c| c.to_string()).unwrap_or_else(|| "null".to_string()),
                suffix
            ));
            break;
        }
        if super::opencode::is_service_running_with_auth(&url, Some((username, &password))).await {
            ready = true;
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    if !ready && failure.is_none() {
        // 健康检查超时（官方 healthTimeout）
        failure = Some(format!(
            "opencode serve in distribution '{}' did not become healthy within {}ms",
            distro, health_timeout_ms
        ));
    }

    if let Some(message) = failure {
        let _ = child.kill().await;
        cleanup_sidecar(&state, id);
        if is_current() {
            set_runtime(&state, id, WslServerRuntime::Failed { message });
        }
        return;
    }

    // attempt 失效：杀掉本次进程避免泄漏
    if !is_current() {
        let _ = child.kill().await;
        cleanup_sidecar(&state, id);
        return;
    }

    // Ready：更新状态并推送（官方 setRuntime ready + sidecars.set）
    set_runtime(
        &state,
        id,
        WslServerRuntime::Ready {
            url: url.clone(),
            username: Some(username.to_string()),
            password: Some(password.clone()),
        },
    );
    refresh_opencode_check_background(app, id.to_string(), distro.clone());

    // 监督：Ready 后进程退出 → failed（官方 listener.onExit → serverExited）。
    // token 触发（stop/remove）时先移除句柄再杀进程，监督任务静默退出；
    // 自然退出时句柄还在 map 里（是自己）→ 标记 failed。
    let watch_token = token.clone();
    let mut child = child;
    if let Ok(status) = tokio::select! {
        status = child.wait() => status,
        _ = watch_token.cancelled() => {
            let _ = child.kill().await;
            cleanup_sidecar(&state, id);
            return;
        }
    } {
        // 只有当 map 里的句柄仍是本次启动注册的（attempt 匹配）才处理退出
        let owned = state
            .sidecars
            .lock()
            .map(|m| m.get(id).map(|h| h.attempt == attempt).unwrap_or(false))
            .unwrap_or(false);
        cleanup_sidecar(&state, id);
        if owned && is_current() {
            set_runtime(
                &state,
                id,
                WslServerRuntime::Failed {
                    message: format!(
                        "opencode serve exited (exit code {})",
                        status.code().map(|c| c.to_string()).unwrap_or_else(|| "null".to_string())
                    ),
                },
            );
        }
    }
}

/// 从 sidecars 移除本次启动的句柄（仅当 token 匹配时）
fn cleanup_sidecar(state: &tauri::State<'_, WslState>, id: &str) {
    if let Ok(mut sidecars) = state.sidecars.lock() {
        sidecars.remove(id);
    }
}

/// 停止 sidecar：从 map 移除句柄并 cancel token（监督任务杀进程）。
/// 官方 stopServerInternal 只 stop listener、不改 runtime。
async fn stop_sidecar_internal(state: &tauri::State<'_, WslState>, id: &str) {
    let handle = state
        .sidecars
        .lock()
        .ok()
        .and_then(|mut m| m.remove(id));
    if let Some(handle) = handle {
        handle.token.cancel();
        // 给监督任务一点时间完成 kill，避免端口/状态竞争
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }
}

// ============================================
// Tauri Commands — 服务器管理
// ============================================

/// 添加 WSL 服务器（官方 addServer：确定性 id、防重复、立即启动、事件推送）
#[command]
pub async fn add_wsl_server(
    distro: String,
    state: tauri::State<'_, WslState>,
) -> Result<WslServerConfig, String> {
    let id = wsl_server_id_for_distro(&distro);

    // 防止重复添加（官方 alreadyAdded）
    {
        let s = state.state.lock().map_err(|e| e.to_string())?;
        if s.servers.iter().any(|item| item.config.id == id) {
            return Err(format!("Server for distribution '{}' has already been added", distro));
        }
    }

    let config = WslServerConfig {
        id: id.clone(),
        distro: distro.clone(),
    };

    // 持久化 → 更新内存（runtime 直接 starting，官方同款）→ 立即启动
    let configs: Vec<WslServerConfig> = {
        let mut s = state.state.lock().map_err(|e| e.to_string())?;
        s.servers.push(WslServerItem {
            config: config.clone(),
            runtime: WslServerRuntime::Starting,
        });
        s.servers.iter().map(|item| item.config.clone()).collect()
    };
    persist_servers(&state.app, &configs)?;
    state.emit();

    start_server_internal(&state.app, &id);
    Ok(config)
}

/// 移除 WSL 服务器（官方 removeServer：invalidate attempt + stop + persist +
/// 清除该 distro 的探测/检查记录）
#[command]
pub async fn remove_wsl_server(id: String, state: tauri::State<'_, WslState>) -> Result<(), String> {
    // 官方 invalidateStartAttempt：使进行中的启动流程失效
    if let Ok(mut attempts) = state.start_attempts.lock() {
        let next = attempts.get(&id).copied().unwrap_or(0) + 1;
        attempts.insert(id.clone(), next);
    }

    stop_sidecar_internal(&state, &id).await;

    // 先取出被删服务器的 distro 名，再删除并持久化剩余配置
    let (removed_distro, remaining): (Option<String>, Vec<WslServerConfig>) = {
        let mut s = state.state.lock().map_err(|e| e.to_string())?;
        let removed = s
            .servers
            .iter()
            .find(|item| item.config.id == id)
            .map(|item| item.config.distro.clone());
        s.servers.retain(|item| item.config.id != id);
        let remaining = s.servers.iter().map(|item| item.config.clone()).collect();
        (removed, remaining)
    };
    let Some(removed_distro) = removed_distro else {
        return Err(format!("Server '{}' not found", id));
    };
    persist_servers(&state.app, &remaining)?;

    // 官方 clearWslDistroState：清除该 distro 的 distroProbes / opencodeChecks
    state.set_state(|s| {
        s.distro_probes.remove(&removed_distro);
        s.opencode_checks.remove(&removed_distro);
    });
    Ok(())
}

/// 启动 WSL 服务器（官方 startServer：立即返回，状态经事件推送）
#[command]
pub async fn start_wsl_server(id: String, state: tauri::State<'_, WslState>) -> Result<(), String> {
    let exists = {
        let s = state.state.lock().map_err(|e| e.to_string())?;
        s.servers.iter().any(|item| item.config.id == id)
    };
    if !exists {
        return Err(format!("Server '{}' not found", id));
    }
    start_server_internal(&state.app, &id);
    Ok(())
}

/// 获取 WSL 状态（官方 getState）
#[command]
pub async fn get_wsl_state(state: tauri::State<'_, WslState>) -> Result<WslServersState, String> {
    let state = state.state.lock().map_err(|e| e.to_string())?;
    Ok(state.clone())
}

/// 停止所有 WSL 服务器（应用退出时调用，官方 stopAll）
pub async fn stop_all_wsl_servers(state: &tauri::State<'_, WslState>) {
    let ids: Vec<String> = match state.state.lock() {
        Ok(s) => s.servers.iter().map(|item| item.config.id.clone()).collect(),
        Err(_) => return,
    };
    // 使所有启动流程失效并逐台停止
    if let Ok(mut attempts) = state.start_attempts.lock() {
        for id in &ids {
            let next = attempts.get(id).copied().unwrap_or(0) + 1;
            attempts.insert(id.clone(), next);
        }
    }
    for id in &ids {
        let _ = stop_sidecar_internal(&state, id).await;
    }
}

/// 应用启动初始化（官方 initialize：恢复配置 + 刷新 opencode 检查 + 全部拉起）
pub fn initialize_wsl(app: &AppHandle) {
    let state = app.state::<WslState>();
    state.restore_persisted();
    let ids = state.persisted_server_ids();
    // 对全部已有服务器后台刷新 opencode 检查（官方 refreshOpencodeChecks）
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<WslState>();
            let distros: Vec<String> = {
                let s = match state.state.lock() {
                    Ok(s) => s,
                    Err(_) => return,
                };
                s.servers.iter().map(|item| item.config.distro.clone()).collect()
            };
            let checks = futures_util::future::join_all(distros.iter().map(|d| check_opencode(d, None))).await;
            let valid_checks: Vec<(String, WslOpencodeCheck)> = checks
                .into_iter()
                .filter_map(|r| r.ok())
                .filter(|check| {
                    state
                        .state
                        .lock()
                        .map(|s| s.servers.iter().any(|item| item.config.distro == check.distro))
                        .unwrap_or(false)
                })
                .map(|check| (check.distro.clone(), check))
                .collect();
            if !valid_checks.is_empty() {
                state.set_state(|s| {
                    for (distro, check) in valid_checks {
                        s.opencode_checks.insert(distro, check);
                    }
                });
            }
        });
    }
    // 启动预热（官方 initialize 没做这一步，但官方靠"启动即拉起服务器"焐热 WSL；
    // 无服务器的机器首开添加对话框会暴露完整的冷启动空窗）：后台探测 runtime，
    // 可用时拉取发行版列表，用户打开对话框时即是热数据。
    // 与对话框自身的 autoProbePlan 撞车时由 begin_job 的取消语义兜底
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if probe_wsl_runtime(app.state::<WslState>()).await.is_ok() {
                let available = {
                    let state = app.state::<WslState>();
                    state
                        .state
                        .lock()
                        .ok()
                        .and_then(|s| s.runtime.as_ref().map(|r| r.available))
                        .unwrap_or(false)
                };
                if available {
                    let _ = refresh_wsl_distros(app.state::<WslState>()).await;
                }
            }
        });
    }
    // 全部服务器自动拉起（官方 wslServerIdsToStartOnInitialize = 全部）
    for id in ids {
        start_server_internal(app, &id);
    }
}
