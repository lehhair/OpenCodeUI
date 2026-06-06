use std::sync::{
    atomic::{AtomicBool, AtomicU32},
    Mutex,
};

/// 跟踪我们是否启动了 opencode serve 进程
pub struct ServiceState {
    /// 我们启动的子进程 PID
    pub child_pid: AtomicU32,
    /// 是否由我们启动（用于关闭时判断是否需要询问）
    pub we_started: AtomicBool,
    /// 我们启动的 opencode serve 实际地址
    pub service_url: Mutex<Option<String>>,
}

impl Default for ServiceState {
    fn default() -> Self {
        Self {
            child_pid: AtomicU32::new(0),
            we_started: AtomicBool::new(false),
            service_url: Mutex::new(None),
        }
    }
}
