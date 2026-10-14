use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 保存时携带最后读取的 revision；省略字段保持现值。
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SettingsPatchRequest {
    pub revision: i64,
    pub comment: Option<CommentSettingsPatch>,
    pub mail: Option<MailSettingsPatch>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CommentSettingsPatch {
    pub moderation: Option<bool>,
    #[schema(minimum = 1)]
    pub max_length: Option<usize>,
    /// 0 表示拒绝所有提交（兼容旧配置）。
    pub rate_limit_per_minute: Option<u32>,
    #[schema(max_length = 64)]
    pub default_nick: Option<String>,
    #[schema(max_length = 2048)]
    pub avatar_cdn: Option<String>,
    pub display_commenter_user_agent: Option<bool>,
    pub captcha: Option<CaptchaSettingsPatch>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CaptchaSettingsPatch {
    pub pow_enabled: Option<bool>,
    #[schema(minimum = 1, maximum = 8)]
    pub pow_difficulty: Option<u32>,
    #[schema(maximum = 31536000)]
    pub pow_ttl_secs: Option<u64>,
    pub image_enabled: Option<bool>,
    #[schema(maximum = 31536000)]
    pub image_ttl_secs: Option<u64>,
    pub image_max_attempts: Option<u32>,
    pub bind_ip: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MailSettingsPatch {
    pub enabled: Option<bool>,
    #[schema(max_length = 255)]
    pub host: Option<String>,
    #[schema(minimum = 1, maximum = 65535)]
    pub port: Option<u16>,
    #[schema(pattern = "^(starttls|tls|none)$")]
    pub security: Option<String>,
    #[schema(max_length = 255)]
    pub username: Option<String>,
    /// 空字符串或省略保留现有密码；非空替换，不 trim。
    #[schema(max_length = 4096)]
    pub password: Option<String>,
    /// 与非空 password 互斥；明确清除已保存密码。
    pub clear_password: Option<bool>,
    #[schema(max_length = 254)]
    pub from_email: Option<String>,
    #[schema(max_length = 255)]
    pub from_name: Option<String>,
    #[schema(max_length = 254)]
    pub admin_email: Option<String>,
    pub notify_admin: Option<bool>,
    pub notify_reply: Option<bool>,
    #[schema(max_length = 255)]
    pub site_name: Option<String>,
    #[schema(max_length = 2048)]
    pub site_url: Option<String>,
    #[schema(pattern = "^(zh-CN|en)$")]
    pub language: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CaptchaSettingsResponse {
    pub pow_enabled: bool,
    pub pow_difficulty: u32,
    pub pow_ttl_secs: u64,
    pub image_enabled: bool,
    pub image_ttl_secs: u64,
    pub image_max_attempts: u32,
    pub bind_ip: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MailSettingsResponse {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub from_email: String,
    pub from_name: String,
    pub admin_email: String,
    pub notify_admin: bool,
    pub notify_reply: bool,
    pub site_name: String,
    pub site_url: String,
    pub language: String,
    pub password_configured: bool,
    pub password_needs_reset: bool,
}
