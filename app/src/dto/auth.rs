use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    #[schema(example = "alice")]
    pub username: String,
    #[schema(example = "secret123")]
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LoginResponse {
    pub access_token: String,
    #[schema(example = "Bearer")]
    pub token_type: String,
    /// 有效期（秒）
    #[schema(example = 86400)]
    pub expires_in: u64,
}
