//! 基于 Redis 的 JWT 黑名单：key 形如 `jwt:bl:{jti}`，TTL 取 token 剩余有效期

use redis::AsyncCommands;
use redis::aio::ConnectionManager;

pub const BLACKLIST_KEY_PREFIX: &str = "jwt:bl:";

fn key(jti: &str) -> String {
    format!("{BLACKLIST_KEY_PREFIX}{jti}")
}

/// jti 是否在黑名单中
pub async fn is_blacklisted(
    conn: &mut ConnectionManager,
    jti: &str,
) -> Result<bool, redis::RedisError> {
    conn.exists(key(jti)).await
}

/// 将 jti 写入黑名单，TTL = token 剩余有效期（秒）。ttl 为 0 时无需写入
pub async fn blacklist(
    conn: &mut ConnectionManager,
    jti: &str,
    ttl_secs: u64,
) -> Result<(), redis::RedisError> {
    if ttl_secs == 0 {
        return Ok(());
    }
    let _: () = conn.set_ex(key(jti), "1", ttl_secs).await?;
    Ok(())
}
