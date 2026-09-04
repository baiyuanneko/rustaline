use axum::extract::State;
use axum::{Json, debug_handler};
use chrono::Utc;

use crate::auth::{admin, blacklist, jwt, middleware::AuthUser};
use crate::dto::{ChangePasswordRequest, LoginRequest, LoginResponse, MessageResponse};
use crate::error::AppError;
use crate::state::AppState;

/// 登录，签发 JWT access token。唯一管理员凭据落库（admins 表），token 携带 token_version
#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Logged in", body = LoginResponse),
        (status = 401, description = "Invalid credentials", body = crate::dto::ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let account = admin::verify_login(&state.db, &payload.username, &payload.password)
        .await?
        .ok_or_else(|| AppError::Unauthorized("invalid username or password".into()))?;

    let (token, _) = jwt::encode_token(
        &account.username,
        account.token_version,
        &state.config.jwt.secret,
        state.config.jwt.ttl_secs,
    )?;

    Ok(Json(LoginResponse {
        access_token: token,
        token_type: "Bearer".into(),
        expires_in: state.config.jwt.ttl_secs,
    }))
}

/// 登出：把当前 token 的 jti 以剩余有效期为 TTL 写入 Redis 黑名单
#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    tag = "auth",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Logged out", body = MessageResponse),
        (status = 401, description = "Missing or invalid token", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn logout(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<MessageResponse>, AppError> {
    if state.config.jwt.blacklist_enabled {
        let mut conn = state
            .redis
            .clone()
            .ok_or_else(|| AppError::Unauthorized("token revocation service unavailable".into()))?;
        let now = Utc::now().timestamp().max(0) as usize;
        let remaining = user.exp.saturating_sub(now) as u64;
        blacklist::blacklist(&mut conn, &user.jti, remaining).await?;
    }
    Ok(Json(MessageResponse {
        message: "logged out".into(),
    }))
}

/// 修改密码（唯一管理员自助）。校验当前密码后写入新哈希并自增 token_version：
/// 包括当前在内的全部旧 token 立即失效，前端应引导重新登录
#[utoipa::path(
    post,
    path = "/api/v1/admin/account/password",
    tag = "auth",
    security(("bearer_auth" = [])),
    request_body = ChangePasswordRequest,
    responses(
        (status = 200, description = "Password updated; all tokens revoked", body = MessageResponse),
        (status = 400, description = "Current password incorrect or new password too weak", body = crate::dto::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn change_password(
    State(state): State<AppState>,
    user: AuthUser,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    admin::change_password(
        &state.db,
        &user.username,
        &payload.current_password,
        &payload.new_password,
    )
    .await?;
    Ok(Json(MessageResponse {
        message: "password updated, please login again".into(),
    }))
}
