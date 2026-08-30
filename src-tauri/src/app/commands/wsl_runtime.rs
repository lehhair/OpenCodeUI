use std::process::{Command as StdCommand, Stdio};
use std::time::Duration;

use regex::Regex;
use tokio::process::Command as TokioCommand;
use tokio_util::sync::CancellationToken;

use super::wsl_types::*;

// ============================================
// WSL 运行时层 —— 对齐官方 packages/desktop/src/main/wsl/runtime.ts
// 所有命令统一走 run_process：超时兜底 + job 取消 + GUI 下隐藏控制台窗口
// ============================================

const DEFAULT_WSL_TIMEOUT_MS: u64 = 20_000;

/// 安装类命令的超时上限（发行版/opencode 下载安装可能持续数分钟，官方 15min）
const INSTALL_TIMEOUT_MS: u64 = 15 * 60_000;

/// 从 UTF-16LE / UTF-8 混杂的 wsl.exe 输出中解出文本。
/// wsl.exe 在控制台输出 UTF-16LE（可能带 BOM），管道输出多为 UTF-8；
/// 官方 detectOutputEncoding 用统计法判断，这里保持同一算法。
fn decode_console_output(bytes: &[u8]) -> String {
    if bytes.len() < 2 {
        return String::from_utf8_lossy(bytes).to_string();
    }
    if bytes[0] == 0xff && bytes[1] == 0xfe {
        // 显式 UTF-16LE BOM，直接解码
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }

    let pairs = bytes.len() / 2;
    if pairs < 2 {
        return String::from_utf8_lossy(bytes).to_string();
    }
    let odd_zeroes = (0..pairs).filter(|&i| bytes[i * 2 + 1] == 0).count();
    let even_zeroes = (0..pairs).filter(|&i| bytes[i * 2] == 0).count();
    if odd_zeroes >= pairs.div_ceil(3) && even_zeroes * 2 <= odd_zeroes {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units).trim_start_matches('\u{FEFF}').to_string()
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

/// WSL 命令执行结果
pub struct WslCommandResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// 组装 wsl.exe 参数：指定了发行版/用户时 args 是 Linux 内命令，需要 "--" 分隔；
/// 否则 args 是 wsl.exe 自身参数（--version / --list），加 "--" 会被当 Linux 命令。
pub fn wsl_args(args: &[String], distro: Option<&str>, user: Option<&str>) -> Vec<String> {
    let mut wsl_args = Vec::new();
    if let Some(d) = distro {
        wsl_args.push("-d".to_string());
        wsl_args.push(d.to_string());
    }
    if let Some(u) = user {
        wsl_args.push("--user".to_string());
        wsl_args.push(u.to_string());
    }
    if distro.is_some() || user.is_some() {
        wsl_args.push("--".to_string());
    }
    wsl_args.extend_from_slice(args);
    wsl_args
}

/// 运行 WSL 命令（官方 runWsl/runWslInDistro）
pub async fn run_wsl_command(
    args: &[String],
    distro: Option<&str>,
    user: Option<&str>,
    timeout_ms: Option<u64>,
    token: Option<&CancellationToken>,
) -> Result<WslCommandResult, String> {
    let wsl_args = wsl_args(args, distro, user);
    run_process("wsl", &wsl_args, timeout_ms.unwrap_or(DEFAULT_WSL_TIMEOUT_MS), token).await
}

/// 运行外部命令：统一处理超时、job 取消与 GUI 下隐藏控制台窗口。
///
/// - 超时/取消时 kill_on_drop 杀掉子进程，避免挂死的 wsl.exe 永远滞留
///   （对齐官方 child.kill()；wsl.exe 在 LXSS 服务卡住时可能永不退出）
/// - 错误信息带上完整命令，日志能直接指认是哪条命令挂了
async fn run_process(
    program: &str,
    args: &[String],
    timeout_ms: u64,
    token: Option<&CancellationToken>,
) -> Result<WslCommandResult, String> {
    let mut cmd = TokioCommand::new(program);
    cmd.args(args);
    // 必须显式把 stdout/stderr 配置为管道：wait_with_output 只回收 piped 的流，
    // 漏配时子进程输出直接丢失（列表/探测全部静默变空，且前端会因两个列表同时
    // 为空而无限触发自动刷新）
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // GUI 应用中 spawn 控制台程序必须隐藏新控制台窗口，否则每次调用都会闪黑框
    // （tokio::process::Command 在 Windows 上自带 creation_flags）
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.kill_on_drop(true);

    let display = format!("{} {}", program, args.join(" "));
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to execute {}: {}", program, e))?;

    let cancel = async {
        match token {
            Some(t) => t.cancelled().await,
            None => std::future::pending::<()>().await,
        }
    };
    let result = tokio::select! {
        r = child.wait_with_output() => r.map_err(|e| format!("Failed to execute {}: {}", program, e))?,
        _ = cancel => return Err("WSL command aborted".to_string()),
        _ = tokio::time::sleep(Duration::from_millis(timeout_ms)) => {
            return Err(format!("`{}` timed out after {}ms", display, timeout_ms));
        }
    };

    Ok(WslCommandResult {
        code: result.status.code(),
        stdout: decode_console_output(&result.stdout),
        stderr: decode_console_output(&result.stderr),
    })
}

/// 运行 PowerShell 命令（WSL 运行时安装需要 UAC 提权，走 Start-Process -Verb RunAs）
async fn run_powershell_command(script: &str, timeout_ms: u64, token: Option<&CancellationToken>) -> Result<WslCommandResult, String> {
    run_process(
        "powershell.exe",
        &[
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-Command".to_string(),
            script.to_string(),
        ],
        timeout_ms,
        token,
    )
    .await
}

/// 提权安装 WSL 运行时（不含发行版），对齐官方 installWslRuntimeElevated
pub async fn install_wsl_runtime(token: Option<&CancellationToken>) -> Result<WslCommandResult, String> {
    let script = [
        "$ErrorActionPreference = 'Stop'",
        "$process = Start-Process -FilePath 'wsl.exe' -Verb RunAs -ArgumentList @('--install','--no-distribution') -Wait -PassThru",
        "if ($null -ne $process.ExitCode) { exit $process.ExitCode }",
    ]
    .join("; ");
    run_powershell_command(&script, INSTALL_TIMEOUT_MS, token).await
}

/// 解析 System32 下的 wsl.exe 绝对路径，避免 PATH 上的同名程序劫持
/// （官方 resolveSystem32Command，安装命令使用）
fn resolve_system32_command(command: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var("SystemRoot")
            .or_else(|_| std::env::var("windir"))
            .unwrap_or_else(|_| r"C:\Windows".to_string());
        let resolved = std::path::Path::new(&root)
            .join("System32")
            .join(command);
        if resolved.exists() {
            return resolved.to_string_lossy().to_string();
        }
    }
    command.to_string()
}

/// 安装指定发行版（--no-launch 装完不自动进入，避免卡在首次交互；官方同款参数）
pub async fn install_wsl_distro(name: &str, token: Option<&CancellationToken>) -> Result<WslCommandResult, String> {
    let program = resolve_system32_command("wsl.exe");
    let args = vec![
        "--install".to_string(),
        "-d".to_string(),
        name.to_string(),
        "--web-download".to_string(),
        "--no-launch".to_string(),
    ];
    run_process(&program, &args, INSTALL_TIMEOUT_MS, token).await
}

/// 在发行版中安装 opencode（官方安装脚本，安装最新版）
pub async fn install_wsl_opencode(distro: &str, token: Option<&CancellationToken>) -> Result<WslCommandResult, String> {
    run_wsl_command(
        &[
            "bash".to_string(),
            "-lc".to_string(),
            "curl -fsSL https://opencode.ai/install | bash".to_string(),
        ],
        Some(distro),
        None,
        Some(INSTALL_TIMEOUT_MS),
        token,
    )
    .await
}

/// 把多行输出压缩成非空行集合（错误信息展示用，对齐官方 summarize）
pub fn summarize(value: &str) -> String {
    value
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 取第一行非空文本（对齐官方 firstLine）
fn first_line(value: &str) -> Option<String> {
    value.lines().map(|l| l.trim()).find(|l| !l.is_empty()).map(|s| s.to_string())
}

/// 探测 WSL 运行时是否可用（官方 probeWslRuntime）
pub async fn probe_wsl_runtime(token: Option<&CancellationToken>) -> Result<WslRuntimeCheck, String> {
    let result = run_wsl_command(&["--version".to_string()], None, None, Some(DEFAULT_WSL_TIMEOUT_MS), token).await;

    match result {
        Ok(r) if r.code == Some(0) => Ok(WslRuntimeCheck {
            available: true,
            version: first_line(&r.stdout),
            error: None,
        }),
        Ok(r) => {
            let error_raw = if r.stderr.is_empty() { r.stdout } else { r.stderr };
            let message = summarize(&error_raw);
            Ok(WslRuntimeCheck {
                available: false,
                version: None,
                error: Some(if message.is_empty() {
                    "WSL is unavailable".to_string()
                } else {
                    message
                }),
            })
        }
        Err(e) => Ok(WslRuntimeCheck {
            available: false,
            version: None,
            error: Some(e),
        }),
    }
}

/// 列出已安装的 WSL 发行版（官方 listInstalledWslDistros）
pub async fn list_installed_distros(token: Option<&CancellationToken>) -> Result<Vec<WslInstalledDistro>, String> {
    let result = run_wsl_command(
        &["--list".to_string(), "--verbose".to_string()],
        None,
        None,
        Some(DEFAULT_WSL_TIMEOUT_MS),
        token,
    )
    .await?;

    if result.code != Some(0) {
        let raw = if result.stderr.is_empty() { result.stdout } else { result.stderr };
        let message = summarize(&raw);
        return Err(if message.is_empty() {
            "Failed to list installed distros".to_string()
        } else {
            message
        });
    }

    parse_installed_distros(&result.stdout)
}

/// 解析已安装的发行版列表（对齐官方正则：名字可含空格，以两空格分隔列）
fn parse_installed_distros(output: &str) -> Result<Vec<WslInstalledDistro>, String> {
    // 官方正则: /^\s*(\*)?\s*(.*?)\s{2,}\S+\s+(\d+)\s*$/
    let re = Regex::new(r"^\s*(\*)?\s*(.*?)\s{2,}\S+\s+(\d+)\s*$").map_err(|e| e.to_string())?;
    let mut distros = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(caps) = re.captures(line) {
            let name = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");
            if name.is_empty() || name.eq_ignore_ascii_case("name") {
                continue;
            }
            let version = caps
                .get(3)
                .and_then(|m| m.as_str().parse::<i32>().ok());
            distros.push(WslInstalledDistro {
                name: name.to_string(),
                version,
                is_default: caps.get(1).is_some(),
            });
        }
    }
    Ok(distros)
}

/// 列出在线可用的发行版（官方 listOnlineWslDistros）
pub async fn list_online_distros(token: Option<&CancellationToken>) -> Result<Vec<WslOnlineDistro>, String> {
    let result = run_wsl_command(
        &["--list".to_string(), "--online".to_string()],
        None,
        None,
        Some(DEFAULT_WSL_TIMEOUT_MS),
        token,
    )
    .await?;

    if result.code != Some(0) {
        let raw = if result.stderr.is_empty() { result.stdout } else { result.stderr };
        let message = summarize(&raw);
        return Err(if message.is_empty() {
            "Failed to list online distros".to_string()
        } else {
            message
        });
    }

    parse_online_distros(&result.stdout)
}

/// 解析在线发行版列表（对齐官方正则：名字限 [A-Za-z0-9._-]，两空格后为友好名）
fn parse_online_distros(output: &str) -> Result<Vec<WslOnlineDistro>, String> {
    // 官方正则: /^([A-Za-z0-9._-]+)\s{2,}(.+)$/
    let re = Regex::new(r"^([A-Za-z0-9._-]+)\s{2,}(.+)$").map_err(|e| e.to_string())?;
    let mut distros = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(caps) = re.captures(trimmed) {
            let name = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            if name.eq_ignore_ascii_case("name") {
                continue;
            }
            distros.push(WslOnlineDistro {
                name: name.to_string(),
                label: caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
            });
        }
    }
    Ok(distros)
}

/// 探测单个发行版的能力（官方 probeWslDistro）。
///
/// 语义对齐：/bin/true 退出码非 0（或命令错误，官方 .catch 转为 code=1）
/// 记录为 can_execute=false 并附带 error 摘要；bash/curl 命令级失败整体失败。
pub async fn probe_distro(name: &str, token: Option<&CancellationToken>) -> Result<WslDistroProbe, String> {
    let executable = match run_wsl_command(
        &["/bin/true".to_string()],
        Some(name),
        None,
        Some(DEFAULT_WSL_TIMEOUT_MS),
        token,
    )
    .await
    {
        Ok(r) => r,
        // 官方 .catch 把命令错误转成 code=1 + stderr=错误消息
        Err(e) => WslCommandResult {
            code: Some(1),
            stdout: String::new(),
            stderr: e,
        },
    };

    if executable.code != Some(0) {
        let raw = if executable.stderr.is_empty() {
            executable.stdout
        } else {
            executable.stderr
        };
        let msg = summarize(&raw);
        let error = if msg.is_empty() {
            format!("Cannot execute commands in distribution '{}'", name)
        } else {
            msg
        };
        return Ok(WslDistroProbe {
            name: name.to_string(),
            can_execute: false,
            has_bash: false,
            has_curl: false,
            error: Some(error),
        });
    }

    // bash / curl 检查并行执行（官方 Promise.all），任一命令级失败整体失败
    let script = |tool: &str| format!("command -v {} >/dev/null && printf yes || printf no", tool);
    let bash_args = ["sh".to_string(), "-lc".to_string(), script("bash")];
    let curl_args = ["sh".to_string(), "-lc".to_string(), script("curl")];
    let (bash, curl) = tokio::join!(
        run_wsl_command(&bash_args, Some(name), None, Some(DEFAULT_WSL_TIMEOUT_MS), token),
        run_wsl_command(&curl_args, Some(name), None, Some(DEFAULT_WSL_TIMEOUT_MS), token),
    );
    let bash = bash?;
    let curl = curl?;

    Ok(WslDistroProbe {
        name: name.to_string(),
        can_execute: true,
        has_bash: bash.code == Some(0) && bash.stdout.trim() == "yes",
        has_curl: curl.code == Some(0) && curl.stdout.trim() == "yes",
        error: None,
    })
}

/// 检查发行版中是否安装了 opencode（官方 resolveWslOpencode）
pub async fn resolve_opencode(distro: &str, token: Option<&CancellationToken>) -> Result<Option<String>, String> {
    let result = run_wsl_command(
        &[
            "sh".to_string(),
            "-lc".to_string(),
            r#"if [ -x "$HOME/.opencode/bin/opencode" ]; then printf "%s\n" "$HOME/.opencode/bin/opencode"; fi"#
                .to_string(),
        ],
        Some(distro),
        None,
        Some(DEFAULT_WSL_TIMEOUT_MS),
        token,
    )
    .await?;

    Ok(first_line(&result.stdout))
}

/// 读取命令版本（官方 readWslCommandVersion；命令路径需要 shell 转义）
pub async fn read_command_version(
    command: &str,
    distro: &str,
    token: Option<&CancellationToken>,
) -> Result<Option<String>, String> {
    let result = run_wsl_command(
        &[
            "sh".to_string(),
            "-lc".to_string(),
            format!("{} --version 2>/dev/null || true", shell_escape(command)),
        ],
        Some(distro),
        None,
        Some(DEFAULT_WSL_TIMEOUT_MS),
        token,
    )
    .await?;

    Ok(first_line(&result.stdout))
}

/// 打开 WSL 终端（官方 openWslTerminal：cmd /c start 新窗口拉起 wsl）
pub fn open_wsl_terminal(distro: Option<&str>) -> Result<(), String> {
    let mut args = vec!["/c".to_string(), "start".to_string(), "".to_string(), "wsl".to_string()];
    if let Some(d) = distro {
        args.push("-d".to_string());
        args.push(d.to_string());
    }

    StdCommand::new("cmd.exe")
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;

    Ok(())
}

/// Shell 转义（启动脚本与安装命令中拼接 shell 源码时使用，官方 shellEscape）
pub fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 回归契约：run_process 必须把子进程 stdout/stderr 管道化——
    // 漏配时 wait_with_output 返回空输出，发行版列表/能力探测会静默全部变空
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn test_run_process_captures_output() {
        let result = run_process(
            "cmd",
            &["/c".to_string(), "echo hello".to_string()],
            5_000,
            None,
        )
        .await
        .expect("run cmd");
        assert_eq!(result.code, Some(0));
        assert_eq!(result.stdout.trim(), "hello");
    }

    #[test]
    fn test_parse_installed_distros() {
        // 真实 wsl -l -v 输出：列间以多空格对齐，名字可含空格
        let output = concat!(
            "\n",
            "  NAME              STATE           VERSION\n",
            "* Ubuntu-22.04      Running         2\n",
            "  docker-desktop    Running         2\n",
            "  Debian GNU/Linux  Stopped         1\n",
        );
        let distros = parse_installed_distros(output).unwrap();
        assert_eq!(distros.len(), 3);
        assert_eq!(distros[0].name, "Ubuntu-22.04");
        assert!(distros[0].is_default);
        assert_eq!(distros[0].version, Some(2));
        assert!(!distros[1].is_default);
        assert_eq!(distros[1].name, "docker-desktop");
        // 带空格的发行版名（官方正则支持）
        assert_eq!(distros[2].name, "Debian GNU/Linux");
        assert_eq!(distros[2].version, Some(1));
    }

    #[test]
    fn test_parse_online_distros() {
        let output = "NAME                            FRIENDLY NAME\nUbuntu                          Ubuntu\nUbuntu-24.04                    Ubuntu 24.04 LTS\n";
        let distros = parse_online_distros(output).unwrap();
        assert_eq!(distros.len(), 2);
        assert_eq!(distros[0].name, "Ubuntu");
        assert_eq!(distros[1].label, "Ubuntu 24.04 LTS");
    }

    #[test]
    fn test_decode_console_output_utf8() {
        assert_eq!(decode_console_output(b"hello\nworld"), "hello\nworld");
    }

    #[test]
    fn test_decode_console_output_utf16le_bom() {
        let text = "Ubuntu\n";
        let mut bytes = vec![0xff, 0xfe];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_console_output(&bytes), text);
    }

    #[test]
    fn test_decode_console_output_utf16le_no_bom() {
        let text = "NAME            STATE";
        let mut bytes: Vec<u8> = Vec::new();
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        // ASCII 文本的 UTF-16LE 编码高位字节全为 0 → 统计法判定为 UTF-16LE
        assert_eq!(decode_console_output(&bytes), text);
    }

    #[test]
    fn test_wsl_args_separator() {
        assert_eq!(
            wsl_args(&["--version".to_string()], None, None),
            vec!["--version".to_string()]
        );
        assert_eq!(
            wsl_args(&["/bin/true".to_string()], Some("Ubuntu"), None),
            vec!["-d".to_string(), "Ubuntu".to_string(), "--".to_string(), "/bin/true".to_string()]
        );
    }

    #[test]
    fn test_shell_escape() {
        assert_eq!(shell_escape("opencode"), "'opencode'");
        assert_eq!(shell_escape("it's"), "'it'\\''s'");
    }
}
