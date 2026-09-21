//! 统一错误类型：所有 handler 返回 AppError，统一序列化为 JSON { code, message }

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

use crate::dto::ErrorResponse;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    TooManyRequests(String),
    #[error("invalid request body")]
    JsonRejection(#[from] axum::extract::rejection::JsonRejection),
    #[error("internal server error")]
    Db(#[from] sea_orm::DbErr),
    #[error("internal server error")]
    Redis(#[from] redis::RedisError),
    #[error("internal server error")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    // password_hash::Error 未实现 std::error::Error，不能用 #[from]，下方手写 From
    #[error("internal server error")]
    PasswordHash(argon2::password_hash::Error),
    /// 内部错误（如验证码生成失败）；对外固定为 500，具体原因仅写日志
    #[error("internal server error")]
    Internal(#[source] Box<dyn std::error::Error + Send + Sync>),
}

impl From<argon2::password_hash::Error> for AppError {
    fn from(err: argon2::password_hash::Error) -> Self {
        Self::PasswordHash(err)
    }
}

impl AppError {
    /// 构造内部错误（500），错误源仅写日志
    pub fn internal<E>(err: E) -> Self
    where
        E: Into<Box<dyn std::error::Error + Send + Sync>>,
    {
        Self::Internal(err.into())
    }

    /// 以字符串描述构造内部错误（500）
    pub fn internal_msg(msg: impl Into<String>) -> Self {
        Self::Internal(Box::<dyn std::error::Error + Send + Sync>::from(msg.into()))
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) | Self::JsonRejection(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::Db(_)
            | Self::Redis(_)
            | Self::Jwt(_)
            | Self::PasswordHash(_)
            | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        if status.is_server_error() {
            // 5xx 不向外暴露内部细节
            tracing::error!(error = ?self, "internal error");
        }
        let body = ErrorResponse {
            code: status.as_u16() as i32,
            message: self.to_string(),
        };
        (status, Json(body)).into_response()
    }
}
