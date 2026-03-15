use std::{
    collections::HashSet,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rand::{Rng, distr::Alphanumeric, rng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{
    sync::RwLock,
    time::{MissedTickBehavior, interval},
};

use crate::{
    caddy,
    config::Config,
    scanner,
    state::{self, RouteInfo},
};

const HTML_TEMPLATE: &str = include_str!("router.html");

#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    preview_port: Arc<RwLock<Option<u16>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutePayloadItem {
    token: String,
    port: u16,
    public_url: String,
    created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutesPayload {
    routes: Vec<RoutePayloadItem>,
    preview_port: Option<u16>,
    preview_domain: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PreviewSetRequest {
    port: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct RoutesQuery {
    format: Option<String>,
}

impl AppState {
    pub fn new(config: Arc<Config>) -> Self {
        Self {
            config,
            preview_port: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn initialize(&self) {
        let state_map = state::load_state_map(self.config.router_state_file()).await;
        let preview_port = state::load_preview_port(&state_map);

        {
            let mut current = self.preview_port.write().await;
            *current = preview_port;
        }

        if let Err(err) = caddy::write_preview_conf(&self.config, preview_port).await {
            log::error!("Failed to write preview config: {}", err);
        }

        if let Some(port) = preview_port {
            log::info!("Restored preview port: {}", port);
        }
    }

    pub fn spawn_sync_loop(self: &Arc<Self>) {
        let state = Arc::clone(self);
        tokio::spawn(async move {
            log::info!(
                "Route scanner started (interval={}s, target={}, range={}-{})",
                state.config.scan_interval(),
                state.config.target_container(),
                state.config.port_range().0,
                state.config.port_range().1,
            );

            let mut ticker = interval(Duration::from_secs(state.config.scan_interval()));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

            loop {
                ticker.tick().await;
                if let Err(err) = state.sync_routes().await {
                    log::error!("Error in sync_routes: {}", err);
                }
            }
        });
    }

    async fn sync_routes(&self) -> Result<(), String> {
        let ports = match scanner::list_listening_ports(&self.config).await {
            Ok(ports) => ports,
            Err(err) => {
                log::warn!(
                    "Failed to query ports from {}: {}",
                    self.config.target_container(),
                    err
                );
                return Ok(());
            }
        };

        let mut state_map = state::load_state_map(self.config.router_state_file()).await;
        let mut routes = state::extract_routes(&state_map);
        let existing_ports: HashSet<u16> = routes.values().map(|info| info.port).collect();
        let mut changed = false;

        for port in &ports {
            if existing_ports.contains(port) {
                continue;
            }

            let mut token = generate_token(self.config.token_length());
            while state_map.contains_key(&token) {
                token = generate_token(self.config.token_length());
            }

            let route = RouteInfo {
                port: *port,
                created_at: now_ts(),
            };

            routes.insert(token.clone(), route.clone());
            state_map.insert(token.clone(), state::route_to_value(&route));
            log::info!("New route: port {} -> /p/{}", port, token);
            changed = true;
        }

        let active_ports: HashSet<u16> = ports.iter().copied().collect();
        let stale_tokens: Vec<String> = routes
            .iter()
            .filter(|(_, info)| !active_ports.contains(&info.port))
            .map(|(token, _)| token.clone())
            .collect();

        for token in stale_tokens {
            if let Some(info) = routes.remove(&token) {
                state_map.remove(&token);
                log::info!("Removed stale route: port {} (token {})", info.port, token);
                changed = true;
            }
        }

        if changed {
            caddy::write_map(&self.config, &routes).await?;
            state::save_state_map(self.config.router_state_file(), &state_map).await?;
            self.reload_gateway().await;
            log::info!("Routes updated: {} active", routes.len());
        }

        Ok(())
    }

    async fn save_preview_port(&self, port: Option<u16>) -> Result<(), String> {
        {
            let mut current = self.preview_port.write().await;
            *current = port;
        }

        let mut state_map = state::load_state_map(self.config.router_state_file()).await;
        state::set_preview_port_value(&mut state_map, port);
        state::save_state_map(self.config.router_state_file(), &state_map).await
    }

    async fn set_preview_port(&self, port: Option<u16>) -> Result<(), String> {
        caddy::write_preview_conf(&self.config, port).await?;
        self.save_preview_port(port).await?;
        self.reload_gateway().await;
        log::info!("Preview port set to: {:?}", port);
        Ok(())
    }

    async fn reload_gateway(&self) {
        if let Err(err) = caddy::reload_gateway().await {
            log::warn!("Failed to reload caddy: {}", err);
        }
    }

    async fn build_routes_payload(&self) -> RoutesPayload {
        let state_map = state::load_state_map(self.config.router_state_file()).await;
        let routes = state::extract_routes(&state_map)
            .into_iter()
            .map(|(token, info)| RoutePayloadItem {
                public_url: self.public_url(&token),
                token,
                port: info.port,
                created_at: info.created_at,
            })
            .collect();

        RoutesPayload {
            routes,
            preview_port: *self.preview_port.read().await,
            preview_domain: non_empty(self.config.preview_domain()),
        }
    }

    fn public_url(&self, token: &str) -> String {
        if !self.config.preview_domain().is_empty() {
            return format!("https://{}/p/{}/", self.config.preview_domain(), token);
        }

        if !self.config.public_base_url().is_empty() {
            return format!("{}/p/{}/", self.config.public_base_url(), token);
        }

        String::new()
    }
}

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/routes", get(get_routes))
        .route("/preview/set", post(post_preview_set))
        .route("/preview/status", get(get_preview_status))
        .with_state(state)
}

async fn get_routes(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RoutesQuery>,
    headers: HeaderMap,
) -> Response {
    if !check_basic_auth(&headers, &state.config) {
        return unauthorized_response();
    }

    let payload = state.build_routes_payload().await;
    log::info!(
        "Serving /routes ({} routes, format={})",
        payload.routes.len(),
        query.format.as_deref().unwrap_or("html")
    );

    if query.format.as_deref() == Some("json") {
        let mut response = Json(payload).into_response();
        set_no_cache_headers(response.headers_mut());
        return response;
    }

    let initial_data = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    let html = HTML_TEMPLATE.replace("__INITIAL_DATA__", &initial_data);
    let mut response = Html(html).into_response();
    set_no_cache_headers(response.headers_mut());
    response
}

async fn get_preview_status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !check_basic_auth(&headers, &state.config) {
        return unauthorized_response();
    }

    let payload = json!({
        "previewPort": *state.preview_port.read().await,
        "previewDomain": non_empty(state.config.preview_domain()),
    });
    Json(payload).into_response()
}

async fn post_preview_set(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    payload: Result<Json<PreviewSetRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !check_basic_auth(&headers, &state.config) {
        return unauthorized_response();
    }

    let Json(request) = match payload {
        Ok(payload) => payload,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid port" })),
            )
                .into_response();
        }
    };

    match state.set_preview_port(request.port).await {
        Ok(()) => Json(json!({ "ok": true, "previewPort": request.port })).into_response(),
        Err(err) => {
            log::error!("Failed to set preview port: {}", err);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "failed to set preview port" })),
            )
                .into_response()
        }
    }
}

fn check_basic_auth(headers: &HeaderMap, config: &Config) -> bool {
    if config.router_password().is_empty() {
        return true;
    }

    let Some(auth_header) = headers.get(header::AUTHORIZATION) else {
        return false;
    };

    let Ok(auth_header) = auth_header.to_str() else {
        return false;
    };

    let Some(raw) = auth_header
        .strip_prefix("Basic ")
        .or_else(|| auth_header.strip_prefix("basic "))
    else {
        return false;
    };

    let Ok(decoded) = STANDARD.decode(raw.trim()) else {
        return false;
    };

    let Ok(decoded) = String::from_utf8(decoded) else {
        return false;
    };

    let Some((user, password)) = decoded.split_once(':') else {
        return false;
    };

    user == config.router_username() && password == config.router_password()
}

fn unauthorized_response() -> Response {
    let mut response = (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    response
        .headers_mut()
        .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Basic"));
    response
}

fn set_no_cache_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
}

fn generate_token(length: usize) -> String {
    rng()
        .sample_iter(Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
