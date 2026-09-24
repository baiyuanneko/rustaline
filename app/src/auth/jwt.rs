//! JWT 签发与校验。claims: sub = 管理员用户名，jti = 随机 uuid（用于黑名单），
//! ver = 签发时的 admins.token_version（改密码后自增，旧 token 立即失效），exp/iat 为秒级时间戳

use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// 管理员用户名（字符串形式，符合 JWT 规范）
    pub sub: String,
    /// token 唯一 id，logout 时写入 Redis 黑名单
    pub jti: String,
    /// 签发时的 admins.token_version；serde default 兼容旧版无 ver 的 token（视为 0）
    #[serde(default)]
    pub ver: i32,
    pub exp: usize,
    pub iat: usize,
}

/// 签发 access token，返回 (token, claims)
pub fn encode_token(
    username: &str,
    token_version: i32,
    secret: &str,
    ttl_secs: u64,
) -> Result<(String, Claims), jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp().max(0) as usize;
    let claims = Claims {
        sub: username.to_owned(),
        jti: Uuid::new_v4().to_string(),
        ver: token_version,
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

/// 校验 token（含签名与 exp），成功返回 claims。
/// leeway 显式置 0（`Validation::default()` 默认 60s）：token 接受窗口必须与
/// logout 黑名单 TTL（exp - now）严格对齐，否则已注销 token 在 [exp, exp+60s) 内会恢复有效
pub fn decode_token(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let validation = Validation {
        leeway: 0,
        ..Default::default()
    };
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-secret-test-secret-test-secret-32";

    #[test]
    fn roundtrip_valid_token() {
        let (token, claims) = encode_token("admin", 1, SECRET, 3600).unwrap();
        let decoded = decode_token(&token, SECRET).unwrap();
        assert_eq!(decoded.sub, "admin");
        assert_eq!(decoded.jti, claims.jti);
        assert_eq!(decoded.ver, 1);
    }

    /// 过期 token 必须立即拒绝：leeway = 0，不允许 exp 之后还有 60s 宽限窗口，
    /// 否则 logout 黑名单（TTL = exp - now）过期后 token 会恢复有效
    #[test]
    fn expired_token_rejected_without_leeway() {
        let now = Utc::now().timestamp().max(0) as usize;
        let claims = Claims {
            sub: "admin".into(),
            jti: Uuid::new_v4().to_string(),
            ver: 0,
            iat: now - 120,
            exp: now - 30, // 过期 30s，处于 jsonwebtoken 默认 leeway(60s) 之内
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();
        assert!(decode_token(&token, SECRET).is_err());
    }
}
