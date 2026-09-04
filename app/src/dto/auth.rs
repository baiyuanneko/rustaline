use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    #[schema(example = "alice")]
    pub username: String,
    #[schema(example = "secret123")]
    pub password: String,
}

/// 修改密码（唯一管理员自助）。成功后 token_version 自增，全部旧 token 失效
#[derive(Debug, Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    #[schema(example = "new-secret-456")]
    pub new_password: String,
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
