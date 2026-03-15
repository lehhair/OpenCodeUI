use std::collections::HashSet;

use tokio::process::Command;

use crate::config::Config;

pub async fn list_listening_ports(config: &Config) -> Result<Vec<u16>, String> {
    let output = run_cmd(&[
        "docker",
        "exec",
        config.target_container(),
        "sh",
        "-c",
        "cat /proc/net/tcp /proc/net/tcp6",
    ])
    .await?;

    let ports = parse_proc_net_tcp(&output);
    let (start, end) = config.port_range();
    let mut filtered: Vec<u16> = ports
        .into_iter()
        .filter(|port| !config.exclude_ports().contains(port))
        .filter(|port| *port >= start && *port <= end)
        .collect();
    filtered.sort_unstable();
    Ok(filtered)
}

pub(crate) async fn run_cmd(args: &[&str]) -> Result<String, String> {
    let (program, rest) = args
        .split_first()
        .ok_or_else(|| "empty command".to_string())?;

    let output = Command::new(program)
        .args(rest)
        .output()
        .await
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!(
            "Command failed (rc={}): {} | stderr: {}",
            output.status.code().unwrap_or(-1),
            args.join(" "),
            stderr,
        );
        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_proc_net_tcp(output: &str) -> HashSet<u16> {
    let mut ports = HashSet::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("sl") {
            continue;
        }

        let mut parts = line.split_whitespace();
        let _slot = parts.next();
        let Some(local) = parts.next() else {
            continue;
        };
        let _remote = parts.next();
        let Some(state) = parts.next() else {
            continue;
        };

        if state != "0A" {
            continue;
        }

        let Some((_, port_hex)) = local.rsplit_once(':') else {
            continue;
        };

        let Ok(port) = u16::from_str_radix(port_hex, 16) else {
            continue;
        };

        ports.insert(port);
    }

    ports
}
