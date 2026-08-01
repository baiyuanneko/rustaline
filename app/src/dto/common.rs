use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    #[schema(example = "ok")]
    pub status: String,
    #[schema(example = "up")]
    pub db: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MessageResponse {
    #[schema(example = "logged out")]
    pub message: String,
}

/// 统一错误响应体
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    /// HTTP 状态码
    #[schema(example = 401)]
    pub code: i32,
    #[schema(example = "invalid or expired token")]
    pub message: String,
}
