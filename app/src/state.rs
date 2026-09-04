use std::sync::Arc;

use redis::aio::ConnectionManager;
use sea_orm::DatabaseConnection;

use crate::config::AppConfig;
use crate::middleware::rate_limit::RateLimiter;

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
}
