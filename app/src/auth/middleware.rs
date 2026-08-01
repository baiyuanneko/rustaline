//! axum extractor `AuthUser`：校验 Bearer token → 黑名单检查 → 注入用户身份

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::http::request::Parts;

use crate::auth::{blacklist, jwt};
use crate::error::AppError;
use crate::state::AppState;

/// 已认证用户。需要登录的 handler 在参数里声明它即可
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: i32,
    /// 当前 token 的 jti（logout 用）
    pub jti: String,
    /// 当前 token 的过期时间（秒级时间戳，logout 计算剩余 TTL 用）
    pub exp: usize,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header_value = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing authorization header".into()))?;

        let token = header_value
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("invalid authorization scheme".into()))?;

        let claims = jwt::decode_token(token, &state.config.jwt.secret)
            .map_err(|_| AppError::Unauthorized("invalid or expired token".into()))?;

        if state.config.jwt.blacklist_enabled {
            let mut conn = state.redis.clone().ok_or_else(|| {
                AppError::Unauthorized("token revocation service unavailable".into())
            })?;
            if blacklist::is_blacklisted(&mut conn, &claims.jti).await? {
                return Err(AppError::Unauthorized("token has been revoked".into()));
            }
        }

        let user_id = claims
            .sub
            .parse::<i32>()
            .map_err(|_| AppError::Unauthorized("invalid token subject".into()))?;

        Ok(AuthUser {
            user_id,
            jti: claims.jti,
            exp: claims.exp,
        })
    }
}
