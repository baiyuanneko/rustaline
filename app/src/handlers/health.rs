use axum::Json;
use axum::extract::State;

use crate::dto::HealthResponse;
use crate::state::AppState;

/// 健康检查
#[utoipa::path(
    get,
    path = "/health",
    tag = "health",
    responses(
        (status = 200, description = "Service is healthy", body = HealthResponse),
    )
)]
pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let db_ok = state.db.ping().await.is_ok();
    Json(HealthResponse {
        status: "ok".into(),
        db: if db_ok { "up" } else { "down" }.into(),
    })
}
