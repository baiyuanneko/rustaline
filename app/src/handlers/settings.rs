use crate::{
    auth::middleware::AuthUser,
    dto::{AdminConfigResponse, SettingsPatchRequest},
    error::AppError,
    services::settings_service,
    state::AppState,
};
use axum::{Json, extract::State};

#[utoipa::path(get, path = "/api/v1/admin/config", tag = "comments-admin", security(("bearer_auth" = [])),
    responses((status = 200, description = "Saved effective business settings", body = AdminConfigResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse)))]
pub async fn get_admin_config(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<AdminConfigResponse>, AppError> {
    let snapshot = settings_service::load(&state.db, &state.config.jwt.secret).await?;
    Ok(Json(settings_service::response(&state.config, &snapshot)))
}

#[utoipa::path(patch, path = "/api/v1/admin/config", tag = "comments-admin", security(("bearer_auth" = [])), request_body = SettingsPatchRequest,
    responses((status = 200, description = "Settings saved", body = AdminConfigResponse),
        (status = 400, description = "Invalid settings", body = crate::dto::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 409, description = "Revision conflict", body = crate::dto::ErrorResponse)))]
pub async fn patch_admin_config(
    State(state): State<AppState>,
    _auth: AuthUser,
    payload: Result<Json<SettingsPatchRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<AdminConfigResponse>, AppError> {
    let Json(patch) = payload?;
    let snapshot = settings_service::update(&state.db, &state.config.jwt.secret, patch).await?;
    Ok(Json(settings_service::response(&state.config, &snapshot)))
}
