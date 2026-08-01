//! JWT 签发与校验。claims: sub = 用户 id，jti = 随机 uuid（用于黑名单），exp/iat 为秒级时间戳

use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// 用户 id（字符串形式，符合 JWT 规范）
    pub sub: String,
    /// token 唯一 id，logout 时写入 Redis 黑名单
    pub jti: String,
    pub exp: usize,
    pub iat: usize,
}

/// 签发 access token，返回 (token, claims)
pub fn encode_token(
    user_id: i32,
    secret: &str,
    ttl_secs: u64,
) -> Result<(String, Claims), jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp().max(0) as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        jti: Uuid::new_v4().to_string(),
        iat: now,
        exp: now + ttl_secs as usize,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok((token, claims))
}

/// 校验 token（含签名与 exp），成功返回 claims
pub fn decode_token(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}
