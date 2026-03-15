use std::{env, ops::Range};

pub struct Config {
    target_container: String,
    routes_file: String,
    preview_file: String,
    router_state_file: String,
    public_base_url: String,
    preview_domain: String,
    router_username: String,
    router_password: String,
    scan_interval: u32,
    token_length: u32,
    port_range: Range<u16>,
    exclude_ports: u16,
}

impl Config {
    pub fn from_env() -> Self {
        let target_container =
            env::var("TARGET_CONTAINER").unwrap_or("opencode-backend".to_string());

        let routes_file = env::var("ROUTES_FILE").unwrap_or("/etc/caddy/routes.conf".to_string());

        let preview_file =
            env::var("PREVIEW_FILE").unwrap_or("/etc/caddy/preview.conf".to_string());

        let router_state_file =
            env::var("ROUTER_STATE_FILE").unwrap_or("/data/routes.json".to_string());

        let public_base_url = match env::var("PUBLIC_BASE_URL") {
            Ok(public_base_url) => public_base_url.trim_end_matches("/").to_string(),
            Err(_) => "".to_string(),
        };

        let preview_domain = match env::var("PREVIEW_DOMAIN") {
            Ok(preview_domain) => preview_domain.trim().to_string(),
            Err(_) => "".to_string(),
        };

        let router_username = env::var("ROUTER_USERNAME").unwrap_or_default();
        let router_password = env::var("ROUTER_PASSWORD").unwrap_or_default();

        let scan_interval = match env::var("ROUTER_SCAN_INTERVAL") {
            Ok(scan_interval_str) => scan_interval_str.parse().unwrap_or_else(|err| {
                log::warn!("can not parse scan_interval: {err}");
                5
            }),
            Err(_) => 5,
        };

        let token_length = match env::var("ROUTER_TOKEN_LENGTH") {
            Ok(token_length_str) => token_length_str.parse().unwrap_or_else(|err| {
                log::warn!("can not parse token_length: {err}");
                12
            }),
            Err(_) => 12,
        };

        let port_range = match env::var("ROUTER_PORT_RANGE") {
            Ok(port_range_str) => {
                let parts: Vec<&str> = port_range_str.trim().split('-').collect();

                if parts.len() != 2 {
                    log::warn!("can not parse port_range: parts.len > 2");
                    3000..10000u16
                } else {
                    let start = parts[0].parse().unwrap_or_else(|err| {
                        log::warn!("can not parse start index: {err}");
                        3000u16
                    });

                    let end = parts[1].parse().unwrap_or_else(|err| {
                        log::warn!("can not parse end index: {err}");
                        10000u16
                    });

                    start..end
                }
            }
            Err(_) => 3000..10000u16,
        };

        let exclude_ports = match env::var("ROUTER_EXCLUDE_PORTS") {
            Ok(exclude_ports_str) => exclude_ports_str.parse().unwrap_or_else(|err| {
                log::warn!("can not parse exclude_ports: {err}");
                4096u16
            }),
            Err(_) => 4096u16,
        };

        Self {
            target_container,
            routes_file,
            preview_file,
            router_state_file,
            public_base_url,
            preview_domain,
            router_username,
            router_password,
            scan_interval,
            token_length,
            port_range,
            exclude_ports,
        }
    }

    pub fn target_container(&self) -> &str {
        &self.target_container
    }

    pub fn routes_file(&self) -> &str {
        &self.routes_file
    }

    pub fn preview_file(&self) -> &str {
        &self.preview_file
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

    pub fn scan_interval(&self) -> u32 {
        self.scan_interval
    }

    pub fn token_length(&self) -> u32 {
        self.token_length
    }

    pub fn port_range(&self) -> Range<u16> {
        self.port_range.clone()
    }

    pub fn exclude_ports(&self) -> u16 {
        self.exclude_ports
    }
}
