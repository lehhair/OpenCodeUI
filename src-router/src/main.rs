mod caddy;
mod config;
mod router;
mod scanner;
mod state;

use std::{net::SocketAddr, sync::Arc};

use config::Config;
use router::AppState;

#[tokio::main]
async fn main() {
    env_logger::init();

    let config = Arc::new(Config::from_env());
    let state = Arc::new(AppState::new(config));

    state.initialize().await;
    state.spawn_sync_loop();

    let app = router::app(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], 7070));

    log::info!("Router starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
