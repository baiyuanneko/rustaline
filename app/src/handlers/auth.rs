use axum::extract::State;
use axum::http::StatusCode;
use axum::{Json, debug_handler};
use chrono::Utc;

use crate::auth::{blacklist, jwt, middleware::AuthUser};
use crate::dto::{LoginRequest, LoginResponse, MessageResponse, RegisterRequest, UserResponse};
use crate::error::AppError;
use crate::services::user_service;
use crate::state::AppState;

/// 注册（创建用户，与 users CRUD 共用 user_service::create_user）
#[utoipa::path(
    post,
    path = "/api/v1/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "User registered", body = UserResponse),
        (status = 400, description = "Invalid input", body = crate::dto::ErrorResponse),
        (status = 409, description = "Username already taken", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = user_service::create_user(&state.db, &payload.username, &payload.password).await?;
    Ok((StatusCode::CREATED, Json(user.into())))
}

/// 登录，签发 JWT access token
#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Logged in", body = LoginResponse),
        (status = 401, description = "Invalid credentials", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let user = user_service::verify_credentials(&state.db, &payload.username, &payload.password)
        .await?
        .ok_or_else(|| AppError::Unauthorized("invalid username or password".into()))?;

    let (token, _) =
        jwt::encode_token(user.id, &state.config.jwt.secret, state.config.jwt.ttl_secs)?;

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
