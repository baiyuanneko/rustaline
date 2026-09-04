//! 启动流程：加载 config → 校验 JWT 密钥 → 初始化 tracing → 连 DB → 跑迁移 → 管理员种子 → 连 Redis → 构建 router → serve + graceful shutdown

use std::error::Error;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use app::config::AppConfig;
use app::middleware::rate_limit::RateLimiter;
use app::state::AppState;
use migration::{Migrator, MigratorTrait};
use redis::aio::ConnectionManager;
use sea_orm::Database;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // 1. 加载配置（内部会先加载 .env）
    let config = AppConfig::load()?;

    // 1.5 JWT 密钥强度校验：弱默认值或过短直接启动失败（放在 load 之外，
    // 不影响手工构造配置的测试与 migration CLI）
    app::config::validate_jwt_secret(&config.jwt.secret).map_err(|e| e.to_string())?;

    // 2. 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(&config.log.level)),
        )
        .init();

    // 3. 连接数据库（SQLite 时先确保数据目录存在）
    ensure_sqlite_parent_dir(&config.database.url)?;
    tracing::info!("connecting to database");
    let db = Database::connect(&config.database.url).await?;

    // 4. 执行未应用的迁移
    tracing::info!("running migrations");
    Migrator::up(&db, None).await?;

    // 4.5 管理员种子：admins 表为空时按 initial_admin 配置种入唯一管理员；
    // 已有记录则忽略环境变量（之后改密码走管理面板，见 auth/admin.rs）
    app::auth::admin::seed_admin(&db, &config.initial_admin).await?;

    // 5. 连接 Redis。黑名单启用时 Redis 是强依赖：连不上直接启动失败
    let redis = connect_redis(&config).await?;

    let state = AppState {
        db,
        redis,
        config: Arc::new(config),
        comment_rate_limiter: RateLimiter::new(),
        login_rate_limiter: RateLimiter::new(),
    };

    // 6. 构建路由并启动服务
    let app = app::routes::create_router(state.clone());
    let addr = format!("{}:{}", state.config.server.host, state.config.server.port);
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!("listening on http://{addr}");
    tracing::info!("swagger ui at http://{addr}/swagger-ui/");

    // into_make_service_with_connect_info 注入 ConnectInfo<SocketAddr> 到请求扩展，
    // 供评论提交 handler 与限流中间件提取客户端真实 IP（无反向代理时为 socket addr）。
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    tracing::info!("shutdown complete");
    Ok(())
}

/// 黑名单启用时连不上 Redis 直接报错；未启用时降级为 None（仅日志告警）
async fn connect_redis(config: &AppConfig) -> Result<Option<ConnectionManager>, Box<dyn Error>> {
    let client = redis::Client::open(config.redis.url.as_str())?;
    match client.get_connection_manager().await {
        Ok(manager) => {
            tracing::info!("connected to redis");
            Ok(Some(manager))
        }
        Err(err) if config.jwt.blacklist_enabled => Err(format!(
            "jwt.blacklist_enabled = true 但无法连接 Redis ({}): {err}",
            config.redis.url
        )
        .into()),
        Err(err) => {
            tracing::warn!("redis unavailable ({err}); continuing without JWT blacklist");
            Ok(None)
        }
    }
}

/// SQLite 文件连接串（如 sqlite://./data/app.db?mode=rwc）先创建父目录，内存库跳过
fn ensure_sqlite_parent_dir(url: &str) -> std::io::Result<()> {
    let Some(rest) = url.strip_prefix("sqlite://") else {
        return Ok(());
    };
    let path_part = rest.split('?').next().unwrap_or("");
    if path_part.is_empty() || path_part == ":memory:" {
        return Ok(());
    }
    if let Some(parent) = Path::new(path_part).parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
