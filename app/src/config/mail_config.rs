use serde::{Deserialize, Serialize};

/// 邮件业务配置。密码仅用于启动播种/解密后的内存快照，禁止序列化与日志回显。
#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct MailConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub from_email: String,
    pub from_name: String,
    pub admin_email: String,
    pub notify_admin: bool,
    pub notify_reply: bool,
    pub site_name: String,
    pub site_url: String,
    pub language: String,
}

impl Default for MailConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: String::new(),
            port: 587,
            security: "starttls".into(),
            username: String::new(),
            password: String::new(),
            from_email: String::new(),
            from_name: String::new(),
            admin_email: String::new(),
            notify_admin: false,
            notify_reply: false,
            site_name: String::new(),
            site_url: String::new(),
            language: "zh-CN".into(),
        }
    }
}

impl std::fmt::Debug for MailConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MailConfig")
            .field("enabled", &self.enabled)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("security", &self.security)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("from_email", &self.from_email)
            .field("from_name", &self.from_name)
            .field("admin_email", &self.admin_email)
            .field("notify_admin", &self.notify_admin)
            .field("notify_reply", &self.notify_reply)
            .field("site_name", &self.site_name)
            .field("site_url", &self.site_url)
            .field("language", &self.language)
            .finish()
    }
}
