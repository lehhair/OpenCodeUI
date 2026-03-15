use std::{collections::HashSet, env};

pub(crate) const ROUTES_FILE: &str = "/etc/caddy/routes.conf";
pub(crate) const PREVIEW_FILE: &str = "/etc/caddy/preview.conf";

#[derive(Clone, Debug)]
pub struct Config {
    target_container: String,
    router_state_file: String,
    public_base_url: String,
    preview_domain: String,
    router_username: String,
    router_password: String,
    scan_interval: u64,
    token_length: usize,
    port_range: (u16, u16),
    exclude_ports: HashSet<u16>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            target_container: env::var("TARGET_CONTAINER")
                .unwrap_or_else(|_| "opencode-backend".to_string()),
            router_state_file: env::var("ROUTER_STATE_FILE")
                .unwrap_or_else(|_| "/data/routes.json".to_string()),
            public_base_url: env::var("PUBLIC_BASE_URL")
                .map(|value| value.trim_end_matches('/').to_string())
                .unwrap_or_default(),
            preview_domain: env::var("PREVIEW_DOMAIN")
                .map(|value| value.trim().to_string())
                .unwrap_or_default(),
            router_username: env::var("ROUTER_USERNAME").unwrap_or_default(),
            router_password: env::var("ROUTER_PASSWORD").unwrap_or_default(),
            scan_interval: parse_u64_env("ROUTER_SCAN_INTERVAL", 5),
            token_length: parse_usize_env("ROUTER_TOKEN_LENGTH", 12),
            port_range: parse_port_range(
                env::var("ROUTER_PORT_RANGE")
                    .ok()
                    .as_deref()
                    .unwrap_or("3000-9999"),
            ),
            exclude_ports: parse_exclude_ports(
                env::var("ROUTER_EXCLUDE_PORTS")
                    .ok()
                    .as_deref()
                    .unwrap_or("4096"),
            ),
        }
    }

    pub fn target_container(&self) -> &str {
        &self.target_container
    }

    pub fn router_state_file(&self) -> &str {
        &self.router_state_file
    }

    pub fn public_base_url(&self) -> &str {
        &self.public_base_url
    }

    pub fn preview_domain(&self) -> &str {
        &self.preview_domain
    }

    pub fn router_username(&self) -> &str {
        &self.router_username
    }

    pub fn router_password(&self) -> &str {
        &self.router_password
    }

    pub fn scan_interval(&self) -> u64 {
        self.scan_interval
    }

    pub fn token_length(&self) -> usize {
        self.token_length
    }

    pub fn port_range(&self) -> (u16, u16) {
        self.port_range
    }

    pub fn exclude_ports(&self) -> &HashSet<u16> {
        &self.exclude_ports
    }
}

fn parse_u64_env(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_usize_env(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}

fn parse_port_range(value: &str) -> (u16, u16) {
    let Some((start, end)) = value.split_once('-') else {
        return (3000, 9999);
    };

    let mut start = start.trim().parse::<u16>().unwrap_or(3000);
    let mut end = end.trim().parse::<u16>().unwrap_or(9999);

    if start > end {
        std::mem::swap(&mut start, &mut end);
    }

    (start, end)
}

fn parse_exclude_ports(value: &str) -> HashSet<u16> {
    value
        .split(',')
        .filter_map(|item| item.trim().parse::<u16>().ok())
        .collect()
}
