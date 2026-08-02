use axum::extract::{Query, State};
use axum::http::{StatusCode, header};
use axum::{Json, debug_handler};

use crate::dto::{
    CommentCreateRequest, CommentListQuery, CommentListResponse, CommentPublicResponse,
};
use crate::error::AppError;
use crate::middleware::rate_limit::ClientIp;
use crate::services::comment_service;
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v1/comments",
    tag = "comments",
    params(CommentListQuery),
    responses(
        (status = 200, description = "List approved comments for a url", body = CommentListResponse),
    )
)]
#[debug_handler]
pub async fn list_comments(
    State(state): State<AppState>,
    Query(query): Query<CommentListQuery>,
) -> Result<Json<CommentListResponse>, AppError> {
    let results = comment_service::list_by_url(&state.db, &query.url).await?;
    let count = results.len() as u64;
    Ok(Json(CommentListResponse { count, results }))
}

#[utoipa::path(
    post,
    path = "/api/v1/comments",
    tag = "comments",
    request_body = CommentCreateRequest,
    responses(
        (status = 201, description = "Comment created", body = CommentPublicResponse),
        (status = 400, description = "Invalid input", body = crate::dto::ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn submit_comment(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: axum::http::HeaderMap,
    Json(payload): Json<CommentCreateRequest>,
) -> Result<(StatusCode, Json<CommentPublicResponse>), AppError> {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let comment =
        comment_service::create_comment(&state.db, &state.config.comment, payload, ip, ua).await?;
    Ok((StatusCode::CREATED, Json(comment)))
}
