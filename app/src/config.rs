//! 分层配置加载：config/default.toml < config/local.toml < APP_* 环境变量。
//!
//! 环境变量两种写法均支持：
//! - 嵌套：`APP_SERVER__PORT=9000`（`__` 分隔层级）
//! - 常用项简写：`APP_DATABASE_URL`、`APP_REDIS_URL`、`APP_JWT_SECRET` 等（见下方映射表）

use config::{Config, File};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    /// 是否采信 X-Forwarded-For 推导真实客户端 IP（反代部署场景）。
    /// 默认 false：一律使用连接对端 IP，XFF 被忽略。
    /// 仅在 app 不可被外部直连（仅经反代可达）时才可开启，否则客户端可伪造 XFF 绕过限流。
    #[serde(default)]
    pub trust_xff: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedisConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JwtConfig {
    pub secret: String,
    /// access token 有效期（秒）
    pub ttl_secs: u64,
    /// 是否启用基于 Redis 的 logout 黑名单
    pub blacklist_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogConfig {
    pub level: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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
    ("APP_TRUST_XFF", "server.trust_xff"),
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

/// 解析环境变量原始字符串：优先按 i64 / bool 解析，保证数值 / 布尔字段能反序列化，
/// 其余按原样字符串处理。
fn parse_env_value(raw: &str) -> config::Value {
    if let Ok(int) = raw.parse::<i64>() {
        int.into()
    } else if let Ok(flag) = raw.parse::<bool>() {
        flag.into()
    } else {
        raw.into()
    }
}

/// 嵌套环境变量（`APP_<段>__<键>`，如 `APP_SERVER__PORT` -> `server.port`）的覆盖项。
///
/// 手动枚举而非 `Environment::with_prefix("APP")`：后者会把 `APP_JWT_SECRET` 这类
/// 单层简写、乃至环境里任何无关的 `APP_*` 变量一并混入配置树（`APP_JWT_SECRET` 会变成
/// 顶层未知键 `jwt_secret`），与结构体上的 `deny_unknown_fields` 冲突导致启动失败。
/// 这里只收含 `__` 的嵌套写法，未知嵌套键同样会在反序列化时被拒绝（拼写错误即报错）。
fn nested_env_overrides() -> Vec<(String, config::Value)> {
    std::env::vars()
        .filter_map(|(name, raw)| {
            let rest = name.strip_prefix("APP_")?;
            if !rest.contains("__") {
                return None;
            }
            Some((
                rest.to_ascii_lowercase().replace("__", "."),
                parse_env_value(&raw),
            ))
        })
        .collect()
}

impl AppConfig {
    pub fn load() -> Result<Self, config::ConfigError> {
        // .env 存在则加载（不存在不视为错误）
        dotenvy::dotenv().ok();

        let mut builder = Config::builder()
            .add_source(File::with_name("config/default"))
            .add_source(File::with_name("config/local").required(false));

        // 嵌套环境变量（APP_X__Y），优先级高于文件。
        for (key, value) in nested_env_overrides() {
            builder = builder.set_override(key, value)?;
        }

        // 常用项的单层环境变量简写，优先级最高。
        for (env, key) in FLAT_ENV_MAP {
            if let Ok(raw) = std::env::var(env) {
                builder = builder.set_override(*key, parse_env_value(&raw))?;
            }
        }

        builder.build()?.try_deserialize()
    }
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, nested_env_overrides, validate_jwt_secret};
    use config::{Config, File, FileFormat};

    /// 嵌套环境变量写法（`APP_<段>__<键>`，README 文档承诺的格式）必须生效。
    #[test]
    fn nested_env_vars_override_config_keys() {
        // crate 内无其他测试读写环境变量；测完即清除，避免泄漏
        unsafe {
            std::env::set_var("APP_DATABASE__URL", "sqlite://nested-env.db?mode=rwc");
            std::env::set_var("APP_SERVER__PORT", "19091");
            std::env::set_var("APP_COMMENT__CAPTCHA__POW_ENABLED", "false");
        }
        let overrides = nested_env_overrides();
        unsafe {
            std::env::remove_var("APP_DATABASE__URL");
            std::env::remove_var("APP_SERVER__PORT");
            std::env::remove_var("APP_COMMENT__CAPTCHA__POW_ENABLED");
        }

        let mut builder = Config::builder();
        for (key, value) in overrides {
            builder = builder.set_override(key, value).expect("set_override");
        }
        let cfg = builder.build().expect("env overrides should build");

        assert_eq!(
            cfg.get_string("database.url").expect("database.url"),
            "sqlite://nested-env.db?mode=rwc",
        );
        // 数值 / 布尔字段不能停留在字符串形态
        assert_eq!(cfg.get::<u16>("server.port").ok(), Some(19091));
        assert_eq!(
            cfg.get::<bool>("comment.captcha.pow_enabled").ok(),
            Some(false),
        );
    }

    /// 单层简写（如 APP_JWT_SECRET）走 FLAT_ENV_MAP 显式映射，不得作为未知键
    /// 混入配置树（否则 deny_unknown_fields 会让任何简写变量都导致启动失败）。
    #[test]
    fn flat_env_names_are_not_collected_as_nested_overrides() {
        unsafe {
            std::env::set_var("APP_JWT_SECRET", "flat-secret");
            std::env::set_var("APP_COMMENT__CAPTCHA__BIND_IP", "true");
        }
        let overrides = nested_env_overrides();
        unsafe {
            std::env::remove_var("APP_JWT_SECRET");
            std::env::remove_var("APP_COMMENT__CAPTCHA__BIND_IP");
        }

        assert!(
            !overrides.iter().any(|(key, _)| key == "jwt_secret"),
            "flat name must not enter config tree: {overrides:?}"
        );
        assert!(
            overrides
                .iter()
                .any(|(key, _)| key == "comment.captcha.bind_ip"),
            "nested name must be collected: {overrides:?}"
        );
    }

    /// 实际 config/default.toml 必须能无未知键地反序列化，且 [comment.captcha]
    /// 段的值真正落到 CaptchaConfig（回归 H-4：段名错位为顶层 [captcha] 时
    /// deny_unknown_fields 会在第一步直接报错）。
    #[test]
    fn default_toml_loads_captcha_section() {
        let cfg: AppConfig = Config::builder()
            .add_source(File::from_str(
                include_str!("../../config/default.toml"),
                FileFormat::Toml,
            ))
            .build()
            .expect("default.toml should parse")
            .try_deserialize()
            .expect("default.toml must contain no unknown keys");

        // 与 config/default.toml 中的值一一对应
        let c = &cfg.comment.captcha;
        assert!(c.pow_enabled);
        assert_eq!(c.pow_difficulty, 4);
        assert_eq!(c.pow_ttl_secs, 600);
        assert!(c.image_enabled);
        assert_eq!(c.image_ttl_secs, 300);
        assert_eq!(c.image_max_attempts, 3);
        assert!(!c.bind_ip);
        assert!(c.secret.is_empty());
    }

    /// 未知键必须在加载时报错而不是被静默忽略（H-4 的原始形态：顶层 [captcha]）。
    #[test]
    fn unknown_keys_are_rejected() {
        let toml = r#"
            [server]
            host = "127.0.0.1"
            port = 8080
            [database]
            url = "sqlite::memory:"
            [redis]
            url = "redis://127.0.0.1:6379"
            [jwt]
            secret = "x"
            ttl_secs = 3600
            blacklist_enabled = false
            [log]
            level = "info"
            [static]
            dir = "static"
            [captcha]
            pow_enabled = true
        "#;
        let err = Config::builder()
            .add_source(File::from_str(toml, FileFormat::Toml))
            .build()
            .expect("toml should parse")
            .try_deserialize::<AppConfig>()
            .expect_err("unknown [captcha] section must be rejected");
        assert!(
            err.to_string().contains("captcha"),
            "error should name the unknown key: {err}"
        );
    }

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
