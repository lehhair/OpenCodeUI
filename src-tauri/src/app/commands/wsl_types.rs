use serde::{Deserialize, Serialize};

// ============================================
// WSL 类型定义 —— 与官方桌面端 packages/app/src/wsl/types.ts 一一对应
// 所有结构体序列化为 camelCase，前端 TypeScript 类型可直接消费
// ============================================

/// WSL 运行时检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslRuntimeCheck {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// 已安装的 WSL 发行版
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslInstalledDistro {
    pub name: String,
    /// WSL 1 或 2
    pub version: Option<i32>,
    pub is_default: bool,
}

/// 在线可用的发行版
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WslOnlineDistro {
    pub name: String,
    pub label: String,
}

/// 发行版探测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistroProbe {
    pub name: String,
    pub can_execute: bool,
    pub has_bash: bool,
    pub has_curl: bool,
    pub error: Option<String>,
}

/// OpenCode 检查结果
///
/// matchesDesktop / expectedVersion 保留官方结构：OpenCodeUI 版本号与
/// opencode 版本无关联（官方桌面端与 opencode 同仓库同版本发布，我们不
/// 是），因此 expected_version 恒为 null、matches_desktop 恒为 null，
/// 前端的 updateOpencode 分支结构保留但不会触发。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslOpencodeCheck {
    pub distro: String,
    pub resolved_path: Option<String>,
    pub version: Option<String>,
    pub expected_version: Option<String>,
    pub matches_desktop: Option<bool>,
    pub error: Option<String>,
}

/// WSL 服务器配置（官方同款：确定性 id = `wsl:<distro>`，无端口字段——
/// 端口在每次启动时动态分配空闲端口）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WslServerConfig {
    pub id: String,
    pub distro: String,
}

/// WSL 服务器运行时状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WslServerRuntime {
    Starting,
    Ready {
        url: String,
        username: Option<String>,
        password: Option<String>,
    },
    Failed {
        message: String,
    },
    Stopped,
}

/// WSL 服务器项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslServerItem {
    pub config: WslServerConfig,
    pub runtime: WslServerRuntime,
}

/// WSL 任务类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WslJob {
    Runtime { started_at: u64 },
    Distros { started_at: u64 },
    InstallWsl { started_at: u64 },
    InstallDistro { distro: String, started_at: u64 },
    ProbeAddable { distros: Vec<String>, started_at: u64 },
    InstallOpencode { distro: String, started_at: u64 },
}

/// WSL 服务器全局状态（官方 WslServersState 同款字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslServersState {
    pub runtime: Option<WslRuntimeCheck>,
    pub installed: Vec<WslInstalledDistro>,
    pub online: Vec<WslOnlineDistro>,
    pub distro_probes: std::collections::HashMap<String, WslDistroProbe>,
    pub opencode_checks: std::collections::HashMap<String, WslOpencodeCheck>,
    pub pending_restart: bool,
    pub servers: Vec<WslServerItem>,
    pub job: Option<WslJob>,
}

impl Default for WslServersState {
    fn default() -> Self {
        Self {
            runtime: None,
            installed: Vec::new(),
            online: Vec::new(),
            distro_probes: std::collections::HashMap::new(),
            opencode_checks: std::collections::HashMap::new(),
            pending_restart: false,
            servers: Vec::new(),
            job: None,
        }
    }
}

/// 服务器 id：确定性生成，同一发行版天然防重复添加（官方 wslServerIdForDistro）
pub fn wsl_server_id_for_distro(distro: &str) -> String {
    format!("wsl:{}", distro)
}
