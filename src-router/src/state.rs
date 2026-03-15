use std::{collections::BTreeMap, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::fs;

const PREVIEW_STATE_KEY: &str = "__preview_port__";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteInfo {
    pub(crate) port: u16,
    pub(crate) created_at: u64,
}

pub(crate) async fn load_state_map(path: &str) -> Map<String, Value> {
    let Ok(content) = fs::read_to_string(path).await else {
        return Map::new();
    };

    serde_json::from_str::<Map<String, Value>>(&content).unwrap_or_default()
}

pub(crate) async fn save_state_map(
    path: &str,
    state_map: &Map<String, Value>,
) -> Result<(), String> {
    ensure_parent_dir(path).await?;

    let mut sorted = BTreeMap::new();
    for (key, value) in state_map {
        sorted.insert(key.clone(), value.clone());
    }

    let body = serde_json::to_string_pretty(&sorted).map_err(|err| err.to_string())?;
    fs::write(path, format!("{body}\n"))
        .await
        .map_err(|err| err.to_string())
}

pub(crate) fn extract_routes(state_map: &Map<String, Value>) -> BTreeMap<String, RouteInfo> {
    state_map
        .iter()
        .filter(|(key, _)| !key.starts_with("__"))
        .filter_map(|(token, value)| {
            serde_json::from_value::<RouteInfo>(value.clone())
                .ok()
                .map(|info| (token.clone(), info))
        })
        .collect()
}

pub(crate) fn route_to_value(route: &RouteInfo) -> Value {
    json!({
        "port": route.port,
        "created_at": route.created_at,
    })
}

pub(crate) fn load_preview_port(state_map: &Map<String, Value>) -> Option<u16> {
    state_map
        .get(PREVIEW_STATE_KEY)
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
}

pub(crate) fn set_preview_port_value(state_map: &mut Map<String, Value>, port: Option<u16>) {
    match port {
        Some(port) => {
            state_map.insert(PREVIEW_STATE_KEY.to_string(), json!(port));
        }
        None => {
            state_map.remove(PREVIEW_STATE_KEY);
        }
    }
}

async fn ensure_parent_dir(path: &str) -> Result<(), String> {
    let Some(parent) = Path::new(path).parent() else {
        return Ok(());
    };

    fs::create_dir_all(parent)
        .await
        .map_err(|err| err.to_string())
}
