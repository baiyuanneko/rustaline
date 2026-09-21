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
    #[serde(default)]
    pub swagger: SwaggerConfig,
    #[serde(default)]
    pub comment: CommentConfig,
    #[serde(default)]
    pub initial_admin: InitialAdminConfig,
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
    /// 静态文件目录（兜底挂载在根路径），相对路径基于应用工作目录
    pub dir: String,
    /// 是否提供演示首页（/ -> static/index.html）；false 时 / 307 重定向到 /admin/
    #[serde(default = "default_true")]
    pub introduction_index: bool,
}

fn default_true() -> bool {
    true
}

/// Swagger UI / OpenAPI 文档开关；关闭后 /swagger-ui 与 /api-doc/openapi.json 不再挂载（404）
#[derive(Debug, Clone, Deserialize)]
pub struct SwaggerConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for SwaggerConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CommentConfig {
    /// true 时新评论 status=pending，需审核后才公开
    #[serde(default)]
    pub moderation: bool,
    /// 评论内容最大长度
    #[serde(default = "default_max_length")]
    pub max_length: usize,
    /// 单 IP 每分钟最多提交数
    #[serde(default = "default_rate_limit_per_minute")]
    pub rate_limit_per_minute: u32,
    /// 未提供昵称时的默认值
    #[serde(default = "default_nick")]
    pub default_nick: String,
    /// 邮箱头像（gravatar 协议）镜像 CDN；置空字符串 = 完全禁用邮箱头像层
    #[serde(default = "default_avatar_cdn")]
    pub avatar_cdn: String,
    /// 是否在公共评论响应中下发 UA 解析摘要（ua_summary，如 "Chrome 126 · Windows"）。
    /// 默认开启；原始 ua 仍只在管理接口出现，关闭该开关即恢复不下发
    #[serde(default = "default_true")]
    pub display_commenter_user_agent: bool,
    /// 评论验证码（PoW / 图形验证码），两套机制独立开关
    #[serde(default)]
    pub captcha: CaptchaConfig,
}

/// 评论验证码配置：PoW 与图形码完全独立，均开启时为 AND（两道都要过）。
/// 评论验证码配置：PoW 与图形码完全独立，同时开启时为 AND（两道都要过）。
/// 默认两种验证码均开启（防滥用优先），可用环境变量显式关闭。
#[derive(Debug, Clone, Deserialize)]
pub struct CaptchaConfig {
    /// 是否启用基于 SHA-256 hashcash 的工作量证明
    #[serde(default = "default_true")]
    pub pow_enabled: bool,
    /// PoW 难度：SHA-256 结果十六进制前导零位数（期望计算 16^n 次）
    #[serde(default = "default_pow_difficulty")]
    pub pow_difficulty: u32,
    /// PoW challenge 有效期（秒）
    #[serde(default = "default_pow_ttl_secs")]
    pub pow_ttl_secs: u64,
    /// 是否启用图形验证码
    #[serde(default = "default_true")]
    pub image_enabled: bool,
    /// 图形验证码有效期（秒）
    #[serde(default = "default_image_ttl_secs")]
    pub image_ttl_secs: u64,
    /// 单个图形码最多错误尝试次数，达到即作废
    #[serde(default = "default_image_max_attempts")]
    pub image_max_attempts: u32,
    /// PoW challenge 是否绑定签发时的客户端 IP（防代理池共享预解）
    #[serde(default)]
    pub bind_ip: bool,
    /// HMAC 签名密钥；留空则从 jwt.secret 域分离派生
    #[serde(default)]
    pub secret: String,
}

fn default_pow_difficulty() -> u32 {
    4
}
fn default_pow_ttl_secs() -> u64 {
    600
}
fn default_image_ttl_secs() -> u64 {
    300
}
fn default_image_max_attempts() -> u32 {
    3
}

impl Default for CaptchaConfig {
    fn default() -> Self {
        Self {
            // 默认两种验证码都开启（防滥用优先）；需要旧行为时用
            // APP_COMMENT_POW_ENABLED=false / APP_COMMENT_CAPTCHA_IMAGE_ENABLED=false 关闭
            pow_enabled: true,
            pow_difficulty: default_pow_difficulty(),
            pow_ttl_secs: default_pow_ttl_secs(),
            image_enabled: true,
            image_ttl_secs: default_image_ttl_secs(),
            image_max_attempts: default_image_max_attempts(),
            bind_ip: false,
            secret: String::new(),
        }
    }
}

fn default_avatar_cdn() -> String {
    "https://gravatar.loli.net/avatar/".to_owned()
}

fn default_max_length() -> usize {
    10000
}
fn default_rate_limit_per_minute() -> u32 {
    5
}
fn default_nick() -> String {
    "Anonymous".to_owned()
}

impl Default for CommentConfig {
    fn default() -> Self {
        Self {
            moderation: false,
            max_length: default_max_length(),
            rate_limit_per_minute: default_rate_limit_per_minute(),
            default_nick: default_nick(),
            avatar_cdn: default_avatar_cdn(),
            display_commenter_user_agent: true,
            captcha: CaptchaConfig::default(),
        }
    }
}

/// 启动时确保存在的初始管理员账号；两个字段都设置才会生效
#[derive(Debug, Clone, Default, Deserialize)]
pub struct InitialAdminConfig {
    pub username: Option<String>,
    pub password: Option<String>,
}

/// 校验 JWT 密钥强度：拒绝已知弱默认值，且要求至少 32 字节。
/// 仅在 main.rs 启动路径调用（Config::load 之外），测试与 migration CLI 不受影响。
pub fn validate_jwt_secret(secret: &str) -> Result<(), String> {
    const KNOWN_WEAK: &[&str] = &["change-me-in-production", "dev-only-secret"];
    if KNOWN_WEAK.contains(&secret) {
        return Err(format!(
            "APP_JWT_SECRET 仍是示例弱密钥 {secret:?}，请用 `openssl rand -base64 48` 生成随机密钥"
        ));
    }
    if secret.len() < 32 {
        return Err(format!(
            "APP_JWT_SECRET 过短（{} 字节，要求 ≥32 字节），请用 `openssl rand -base64 48` 生成随机密钥",
            secret.len()
        ));
    }
    Ok(())
}

/// 校验验证码配置的合理取值范围。仅在 main.rs 启动路径调用。
pub fn validate_captcha_config(comment: &CommentConfig) -> Result<(), String> {
    let c = &comment.captcha;
    if !(1..=8).contains(&c.pow_difficulty) {
        return Err(format!(
            "comment.captcha.pow_difficulty 超出范围（{}，要求 1..=8）",
            c.pow_difficulty
        ));
    }
    if c.pow_enabled && c.pow_ttl_secs == 0 {
        return Err("comment.captcha.pow_ttl_secs 不能为 0".into());
    }
    if c.image_enabled && c.image_ttl_secs == 0 {
        return Err("comment.captcha.image_ttl_secs 不能为 0".into());
    }
    if c.image_enabled && c.image_max_attempts == 0 {
        return Err("comment.captcha.image_max_attempts 不能为 0".into());
    }
    Ok(())
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
    ("APP_ENABLE_INTRODUCTION_INDEX", "static.introduction_index"),
    ("APP_ENABLE_SWAGGER_UI", "swagger.enabled"),
    ("APP_COMMENT_MODERATION", "comment.moderation"),
    ("APP_COMMENT_MAX_LENGTH", "comment.max_length"),
    (
        "APP_COMMENT_RATE_LIMIT_PER_MINUTE",
        "comment.rate_limit_per_minute",
    ),
    ("APP_COMMENT_DEFAULT_NICK", "comment.default_nick"),
    ("APP_AVATAR_CDN", "comment.avatar_cdn"),
    (
        "APP_DISPLAY_COMMENTER_USER_AGENT",
        "comment.display_commenter_user_agent",
    ),
    ("APP_COMMENT_POW_ENABLED", "comment.captcha.pow_enabled"),
    (
        "APP_COMMENT_POW_DIFFICULTY",
        "comment.captcha.pow_difficulty",
    ),
    ("APP_COMMENT_POW_TTL_SECS", "comment.captcha.pow_ttl_secs"),
    (
        "APP_COMMENT_CAPTCHA_IMAGE_ENABLED",
        "comment.captcha.image_enabled",
    ),
    (
        "APP_COMMENT_CAPTCHA_IMAGE_TTL_SECS",
        "comment.captcha.image_ttl_secs",
    ),
    (
        "APP_COMMENT_CAPTCHA_IMAGE_MAX_ATTEMPTS",
        "comment.captcha.image_max_attempts",
    ),
    ("APP_COMMENT_CAPTCHA_BIND_IP", "comment.captcha.bind_ip"),
    ("APP_COMMENT_CAPTCHA_SECRET", "comment.captcha.secret"),
    ("APP_INITIAL_ADMIN_USERNAME", "initial_admin.username"),
    ("APP_INITIAL_ADMIN_PASSWORD", "initial_admin.password"),
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

#[cfg(test)]
mod tests {
    use super::validate_jwt_secret;

    #[test]
    fn jwt_secret_rejects_known_weak_values() {
        for weak in ["change-me-in-production", "dev-only-secret"] {
            let err = validate_jwt_secret(weak).expect_err("weak default must be rejected");
            assert!(err.contains("openssl rand"), "error should hint fix: {err}");
        }
    }

    #[test]
    fn jwt_secret_rejects_short_values() {
        let err = validate_jwt_secret("test-secret").expect_err("short secret must be rejected");
        assert!(err.contains("≥32"), "error should state minimum: {err}");
        // 31 字节差一字节也不行；空字符串同理
        assert!(validate_jwt_secret(&"a".repeat(31)).is_err());
        assert!(validate_jwt_secret("").is_err());
    }

    #[test]
    fn jwt_secret_accepts_strong_values() {
        assert!(validate_jwt_secret(&"a".repeat(32)).is_ok());
        // openssl rand -base64 48 的典型输出长度
        assert!(validate_jwt_secret(&"x".repeat(64)).is_ok());
    }
}
