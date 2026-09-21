use std::sync::Arc;

use redis::aio::ConnectionManager;
use sea_orm::DatabaseConnection;

use crate::config::AppConfig;
use crate::middleware::rate_limit::RateLimiter;
use crate::services::captcha_service::CaptchaMemoryStore;

/// 全局应用状态。redis 为 None 表示黑名单未启用且启动时 Redis 不可达（降级运行）。
/// 管理员凭据不在此驻留：唯一管理员落库（admins 表），认证时查库校验（auth/admin.rs）。
#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub redis: Option<ConnectionManager>,
    pub config: Arc<AppConfig>,
    pub comment_rate_limiter: RateLimiter,
    /// 登录接口限流（5 次/分钟/IP，防爆破），与评论限流独立
    pub login_rate_limiter: RateLimiter,
    /// PoW challenge 签发限流（防刷接口），与图形码签发各自独立
    pub pow_issue_rate_limiter: RateLimiter,
    /// 图形验证码签发限流（图片生成有 CPU 成本）
    pub image_issue_rate_limiter: RateLimiter,
    /// 验证码凭证的进程内存储（Redis 不可达时的降级路径；单实例语义）
    pub captcha_memory: Arc<CaptchaMemoryStore>,
    /// PoW challenge HMAC 签名密钥（captcha.secret 缺省时由 jwt.secret 派生），启动时计算一次
    pub captcha_signing_key: Arc<Vec<u8>>,
}
