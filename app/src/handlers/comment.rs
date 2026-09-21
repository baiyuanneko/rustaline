use axum::extract::{Query, State};
use axum::http::{StatusCode, header};
use axum::{Json, debug_handler};

use crate::dto::{
    CommentCreateRequest, CommentListQuery, CommentPublicResponse, CommentRepliesQuery,
    CommentRepliesResponse, CommentThreadResponse,
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
        (status = 200, description = "Paginated threads (roots + reply previews) for a url", body = CommentThreadResponse),
    )
)]
#[debug_handler]
pub async fn list_comments(
    State(state): State<AppState>,
    Query(query): Query<CommentListQuery>,
) -> Result<Json<CommentThreadResponse>, AppError> {
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(0); // 0 = 服务端默认
    let resp = comment_service::list_threads(
        &state.db,
        &state.config.comment,
        &query.url,
        page,
        page_size,
    )
    .await?;
    Ok(Json(resp))
}

#[utoipa::path(
    get,
    path = "/api/v1/comments/replies",
    tag = "comments",
    params(CommentRepliesQuery),
    responses(
        (status = 200, description = "Replies inside one thread (ordered by time asc)", body = CommentRepliesResponse),
        (status = 400, description = "Invalid rid", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn list_replies(
    State(state): State<AppState>,
    Query(query): Query<CommentRepliesQuery>,
) -> Result<Json<CommentRepliesResponse>, AppError> {
    let resp = comment_service::list_replies(
        &state.db,
        &state.config.comment,
        &query.url,
        &query.rid,
        query.offset.unwrap_or(0),
        query.limit.unwrap_or(0), // 0 = 服务端默认
    )
    .await?;
    Ok(Json(resp))
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
    // UA 由服务端采集；超长截断到列宽（varchar(512)，M-3），按字符边界安全截断
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            s.chars()
                .take(comment_service::MAX_UA_LEN)
                .collect::<String>()
        });
    let comment = comment_service::create_comment(
        &state.db,
        &state.redis,
        &state.captcha_memory,
        &state.captcha_signing_key,
        &state.config.comment,
        payload,
        ip,
        ua,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(comment)))
}
