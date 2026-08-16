use std::sync::Arc;

use redis::aio::ConnectionManager;
use sea_orm::DatabaseConnection;

use crate::auth::admin::AdminCredentials;
use crate::config::AppConfig;
use crate::middleware::rate_limit::RateLimiter;

/// 全局应用状态。redis 为 None 表示黑名单未启用且启动时 Redis 不可达（降级运行）
#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub redis: Option<ConnectionManager>,
    pub config: Arc<AppConfig>,
    pub comment_rate_limiter: RateLimiter,
    /// 唯一管理员凭据（来自 initial_admin 配置，启动时构建）
    pub admin: AdminCredentials,
}
