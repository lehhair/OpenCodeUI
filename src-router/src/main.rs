mod config;
mod router;

use axum::{
    Router,
    routing::{get, post},
};
use config::Config;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let _cfg = Config::from_env();

    let app = Router::new()
        .route("/routes", get(|| async {}))
        .route("/preview/set", post(|| async {}))
        .route("/preview/status", get(|| async {}));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:7070").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}
