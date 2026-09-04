use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, debug_handler};

use crate::auth::middleware::AuthUser;
use crate::dto::{
    AdminCommentListResponse, AdminCommentQuery, AdminConfigResponse, CommentStatsResponse,
    CommentStatusUpdate, ValineImportReport,
};
use crate::error::AppError;
use crate::services::{comment_service, import_service};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v1/admin/comments",
    tag = "comments-admin",
    security(("bearer_auth" = [])),
    params(AdminCommentQuery),
    responses(
        (status = 200, description = "Paginated comment list", body = AdminCommentListResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn list_admin_comments(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(query): Query<AdminCommentQuery>,
) -> Result<Json<AdminCommentListResponse>, AppError> {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
    let result = comment_service::list_admin(
        &state.db,
        &state.config.comment,
        query.status.as_deref(),
        query.url.as_deref(),
        query.keyword.as_deref(),
        page,
        page_size,
    )
    .await?;
    Ok(Json(result))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/comments/{id}",
    tag = "comments-admin",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Comment id")),
    request_body = CommentStatusUpdate,
    responses(
        (status = 200, description = "Status updated", body = crate::dto::AdminCommentResponse),
        (status = 400, description = "Invalid status", body = crate::dto::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 404, description = "Comment not found", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn update_comment_status(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<String>,
    Json(payload): Json<CommentStatusUpdate>,
) -> Result<Json<crate::dto::AdminCommentResponse>, AppError> {
    let result =
        comment_service::update_status(&state.db, &state.config.comment, &id, payload).await?;
    Ok(Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/comments/{id}",
    tag = "comments-admin",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "Comment id")),
    responses(
        (status = 204, description = "Comment deleted"),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 404, description = "Comment not found", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn delete_comment(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    comment_service::delete_comment(&state.db, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/comments/import/valine",
    tag = "comments-admin",
    security(("bearer_auth" = [])),
    request_body = crate::dto::ValineImportRequest,
    responses(
        (status = 200, description = "Import report", body = ValineImportReport),
        (status = 400, description = "Invalid payload or batch too large", body = crate::dto::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn import_valine(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ValineImportReport>, AppError> {
    let report = import_service::import_valine(&state.db, body).await?;
    Ok(Json(report))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/comments/stats",
    tag = "comments-admin",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Dashboard stats", body = CommentStatsResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_stats(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<CommentStatsResponse>, AppError> {
    let stats = comment_service::get_stats(&state.db).await?;
    Ok(Json(stats))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/config",
    tag = "comments-admin",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Effective config", body = AdminConfigResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_admin_config(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<AdminConfigResponse>, AppError> {
    Ok(Json(comment_service::get_admin_config(&state.config)))
}
