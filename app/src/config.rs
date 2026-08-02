//! 分层配置加载：config/default.toml < config/local.toml < APP_* 环境变量。
//!
//! 环境变量两种写法均支持：
//! - 嵌套：`APP_SERVER__PORT=9000`（`__` 分隔层级）
//! - 常用项简写：`APP_DATABASE_URL`、`APP_REDIS_URL`、`APP_JWT_SECRET` 等（见下方映射表）

use config::{Config, Environment, File};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub jwt: JwtConfig,
    pub log: LogConfig,
    #[serde(rename = "static")]
    pub static_: StaticConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwtConfig {
    pub secret: String,
    /// access token 有效期（秒）
    pub ttl_secs: u64,
    /// 是否启用基于 Redis 的 logout 黑名单
    pub blacklist_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LogConfig {
    pub level: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StaticConfig {
    /// 静态文件目录（挂载在 /static 下），相对路径基于应用工作目录
    pub dir: String,
}

/// 单层环境变量简写 -> 嵌套配置键
const FLAT_ENV_MAP: &[(&str, &str)] = &[
    ("APP_SERVER_HOST", "server.host"),
    ("APP_SERVER_PORT", "server.port"),
    ("APP_DATABASE_URL", "database.url"),
    ("APP_REDIS_URL", "redis.url"),
    ("APP_JWT_SECRET", "jwt.secret"),
    ("APP_JWT_TTL_SECS", "jwt.ttl_secs"),
    ("APP_JWT_BLACKLIST_ENABLED", "jwt.blacklist_enabled"),
    ("APP_LOG_LEVEL", "log.level"),
    ("APP_STATIC_DIR", "static.dir"),
];

impl AppConfig {
    pub fn load() -> Result<Self, config::ConfigError> {
        // .env 存在则加载（不存在不视为错误）
        dotenvy::dotenv().ok();

        let mut builder = Config::builder()
            .add_source(File::with_name("config/default"))
            .add_source(File::with_name("config/local").required(false))
            .add_source(Environment::with_prefix("APP").separator("__"));

        // 常用项的单层环境变量简写，优先级最高。
        // 预先按 i64 / bool 解析，保证能反序列化到数值 / 布尔字段
        for (env, key) in FLAT_ENV_MAP {
            if let Ok(raw) = std::env::var(env) {
                let value: config::Value = if let Ok(int) = raw.parse::<i64>() {
                    int.into()
                } else if let Ok(flag) = raw.parse::<bool>() {
                    flag.into()
                } else {
                    raw.into()
                };
                builder = builder.set_override(*key, value)?;
            }
        }

        builder.build()?.try_deserialize()
    }
}
