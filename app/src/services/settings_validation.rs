use crate::config::{CommentConfig, MailConfig, validate_captcha_config};
use crate::error::AppError;

fn invalid(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}

fn length(value: &str, max: usize, field: &str) -> Result<(), AppError> {
    if value.chars().count() > max || value.contains(['\r', '\n', '\0']) {
        return Err(invalid(&format!(
            "{field} is too long or contains control characters"
        )));
    }
    Ok(())
}

pub(super) fn validate(
    comment: &CommentConfig,
    mail: &MailConfig,
    password_needs_reset: bool,
) -> Result<(), AppError> {
    length(
        &comment.default_nick,
        super::comment_service::MAX_NICK_LEN,
        "comment.default_nick",
    )?;
    length(&comment.avatar_cdn, 2048, "comment.avatar_cdn")?;
    validate_captcha_config(comment).map_err(|_| invalid("invalid comment captcha settings"))?;
    // 使用固定业务上限，保存的设置不会随着当前时间增长而越过 Redis 的过期边界。
    const MAX_CAPTCHA_TTL_SECS: u64 = 365 * 24 * 60 * 60;
    if comment.captcha.pow_ttl_secs > MAX_CAPTCHA_TTL_SECS
        || comment.captcha.image_ttl_secs > MAX_CAPTCHA_TTL_SECS
    {
        return Err(invalid("captcha TTL must not exceed one year"));
    }
    if mail.port == 0 {
        return Err(invalid("mail.port must be between 1 and 65535"));
    }
    if !["starttls", "tls", "none"].contains(&mail.security.as_str()) {
        return Err(invalid("invalid mail.security"));
    }
    if !["zh-CN", "en"].contains(&mail.language.as_str()) {
        return Err(invalid("invalid mail.language"));
    }
    for (field, value, max) in [
        ("mail.host", mail.host.as_str(), 255),
        ("mail.username", &mail.username, 255),
        ("mail.from_name", &mail.from_name, 255),
        ("mail.site_name", &mail.site_name, 255),
        ("mail.site_url", &mail.site_url, 2048),
    ] {
        length(value, max, field)?;
    }
    if mail.password.chars().count() > 4096 {
        return Err(invalid("mail.password exceeds 4096 characters"));
    }
    for (field, address) in [
        ("mail.from_email", &mail.from_email),
        ("mail.admin_email", &mail.admin_email),
    ] {
        length(address, 254, field)?;
        if !address.is_empty() && !email_address::EmailAddress::is_valid(address) {
            return Err(invalid(&format!("invalid {field}")));
        }
    }
    if !mail.site_url.is_empty() {
        let parsed =
            url::Url::parse(&mail.site_url).map_err(|_| invalid("invalid mail.site_url"))?;
        if !["http", "https"].contains(&parsed.scheme())
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(invalid("mail.site_url must be an HTTP or HTTPS address"));
        }
    }
    if !mail.password.is_empty() && mail.username.is_empty() {
        return Err(invalid("mail.password requires mail.username"));
    }
    if mail.enabled {
        if mail.host.trim().is_empty()
            || mail.host.chars().any(char::is_whitespace)
            || mail.from_email.is_empty()
        {
            return Err(invalid("enabled SMTP requires a host and from_email"));
        }
        if !mail.username.is_empty() && mail.password.is_empty() && !password_needs_reset {
            return Err(invalid("SMTP authentication requires a password"));
        }
        if mail.notify_admin && mail.admin_email.is_empty() {
            return Err(invalid("admin notifications require admin_email"));
        }
        if (mail.notify_admin || mail.notify_reply)
            && (mail.site_name.trim().is_empty() || mail.site_url.is_empty())
        {
            return Err(invalid("mail notifications require site_name and site_url"));
        }
    }
    Ok(())
}

/// 原部署配置允许这些值；仅管理员编辑评论分组时要求修正。
pub(super) fn validate_comment_edit(comment: &CommentConfig) -> Result<(), AppError> {
    if comment.max_length == 0 {
        return Err(invalid("comment.max_length must be positive"));
    }
    if comment.default_nick.trim().is_empty() {
        return Err(invalid("comment.default_nick must not be empty"));
    }
    Ok(())
}
