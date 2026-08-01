use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Json, debug_handler};

use crate::auth::middleware::AuthUser;
use crate::dto::{CreateUserRequest, UpdateUserRequest, UserResponse};
use crate::error::AppError;
use crate::services::user_service;
use crate::state::AppState;

/// 用户列表
#[utoipa::path(
    get,
    path = "/api/v1/users",
    tag = "users",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List users", body = [UserResponse]),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn list_users(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<UserResponse>>, AppError> {
    let users = user_service::list_users(&state.db).await?;
    Ok(Json(users.into_iter().map(Into::into).collect()))
}

/// 创建用户
#[utoipa::path(
    post,
    path = "/api/v1/users",
    tag = "users",
    security(("bearer_auth" = [])),
    request_body = CreateUserRequest,
    responses(
        (status = 201, description = "User created", body = UserResponse),
        (status = 400, description = "Invalid input", body = crate::dto::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 409, description = "Username already taken", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn create_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), AppError> {
    let user = user_service::create_user(&state.db, &payload.username, &payload.password).await?;
    Ok((StatusCode::CREATED, Json(user.into())))
}

/// 查询单个用户
#[utoipa::path(
    get,
    path = "/api/v1/users/{id}",
    tag = "users",
    security(("bearer_auth" = [])),
    params(("id" = i32, Path, description = "User id")),
    responses(
        (status = 200, description = "User found", body = UserResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 404, description = "User not found", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<i32>,
) -> Result<Json<UserResponse>, AppError> {
    let user = user_service::get_user(&state.db, id).await?;
    Ok(Json(user.into()))
}

/// 更新用户（用户名 / 密码均可选）
#[utoipa::path(
    put,
    path = "/api/v1/users/{id}",
    tag = "users",
    security(("bearer_auth" = [])),
    params(("id" = i32, Path, description = "User id")),
    request_body = UpdateUserRequest,
    responses(
        (status = 200, description = "User updated", body = UserResponse),
        (status = 400, description = "Invalid input", body = crate::dto::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 404, description = "User not found", body = crate::dto::ErrorResponse),
        (status = 409, description = "Username already taken", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn update_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let user = user_service::update_user(&state.db, id, payload).await?;
    Ok(Json(user.into()))
}

/// 删除用户
#[utoipa::path(
    delete,
    path = "/api/v1/users/{id}",
    tag = "users",
    security(("bearer_auth" = [])),
    params(("id" = i32, Path, description = "User id")),
    responses(
        (status = 204, description = "User deleted"),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse),
        (status = 404, description = "User not found", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn delete_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    user_service::delete_user(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
