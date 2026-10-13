//! 数据库业务设置；每个请求持有独立快照，无跨 await 的共享锁。
use chrono::Utc;
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};

use super::{settings_crypto, settings_validation};
use crate::config::{AppConfig, CommentConfig, MailConfig};
use crate::dto::{
    AdminConfigResponse, CaptchaSettingsResponse, CommentConfigResponse, MailSettingsResponse,
    SettingsPatchRequest,
};
use crate::entities::app_settings;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct SettingsSnapshot {
    pub revision: i64,
    pub comment: CommentConfig,
    pub mail: MailConfig,
    pub password_needs_reset: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Content {
    comment: CommentConfig,
    mail: MailConfig,
}

async fn row(db: &DatabaseConnection) -> Result<app_settings::Model, AppError> {
    app_settings::Entity::find_by_id(1)
        .one(db)
        .await?
        .ok_or_else(|| AppError::internal_msg("runtime settings have not been initialized"))
}

fn decode(row: &app_settings::Model, jwt_secret: &str) -> Result<SettingsSnapshot, AppError> {
    if row.schema_version != 1 {
        return Err(AppError::internal_msg(
            "unsupported runtime settings schema version",
        ));
    }
    let mut content: Content = serde_json::from_str(&row.content).map_err(AppError::internal)?;
    // 即使数据库被手工编辑，也不允许业务 JSON 覆盖部署密钥或提供明文密码。
    content.comment.captcha.secret.clear();
    content.mail.password.clear();
    let mut password_needs_reset = false;
    if let Some(ciphertext) = &row.smtp_password_ciphertext {
        match settings_crypto::decrypt(ciphertext, jwt_secret) {
            Some(password) => content.mail.password = password,
            None => password_needs_reset = true,
        }
    }
    Ok(SettingsSnapshot {
        revision: row.revision,
        comment: content.comment,
        mail: content.mail,
        password_needs_reset,
    })
}

pub async fn initialize(
    db: &DatabaseConnection,
    bootstrap: &AppConfig,
) -> Result<SettingsSnapshot, AppError> {
    if app_settings::Entity::find_by_id(1).one(db).await?.is_some() {
        let snapshot = load(db, &bootstrap.jwt.secret).await?;
        validate(&snapshot)?;
        return Ok(snapshot);
    }
    settings_validation::validate(&bootstrap.comment, &bootstrap.mail, false)?;
    let ciphertext = if bootstrap.mail.password.is_empty() {
        None
    } else {
        Some(settings_crypto::encrypt(
            &bootstrap.mail.password,
            &bootstrap.jwt.secret,
        )?)
    };
    let now = Utc::now().naive_utc();
    seed_insert(app_settings::ActiveModel {
        id: Set(1),
        schema_version: Set(1),
        revision: Set(1),
        content: Set(serde_json::to_string(&Content {
            comment: bootstrap.comment.clone(),
            mail: bootstrap.mail.clone(),
        })
        .map_err(AppError::internal)?),
        smtp_password_ciphertext: Set(ciphertext),
        created_at: Set(now),
        updated_at: Set(now),
    })
    .try_insert()
    .exec(db)
    .await?;
    let snapshot = load(db, &bootstrap.jwt.secret).await?;
    validate(&snapshot)?;
    Ok(snapshot)
}

fn seed_insert(model: app_settings::ActiveModel) -> sea_orm::Insert<app_settings::ActiveModel> {
    app_settings::Entity::insert(model).on_conflict(
        OnConflict::column(app_settings::Column::Id)
            .do_nothing_on([app_settings::Column::Id])
            .to_owned(),
    )
}

pub async fn load(db: &DatabaseConnection, jwt_secret: &str) -> Result<SettingsSnapshot, AppError> {
    decode(&row(db).await?, jwt_secret)
}

pub fn validate(snapshot: &SettingsSnapshot) -> Result<(), AppError> {
    settings_validation::validate(
        &snapshot.comment,
        &snapshot.mail,
        snapshot.password_needs_reset,
    )
}

macro_rules! merge {
    ($target:expr, $patch:expr, $($field:ident),+ $(,)?) => {
        $(if let Some(value) = $patch.$field { $target.$field = value; })+
    };
}

pub async fn update(
    db: &DatabaseConnection,
    jwt_secret: &str,
    patch: SettingsPatchRequest,
) -> Result<SettingsSnapshot, AppError> {
    let existing = row(db).await?;
    let mut snapshot = decode(&existing, jwt_secret)?;
    if patch.revision != snapshot.revision {
        return Err(AppError::Conflict(
            "settings were modified; reload before saving".into(),
        ));
    }
    let mut ciphertext = existing.smtp_password_ciphertext;
    if let Some(comment) = patch.comment {
        merge!(
            snapshot.comment,
            comment,
            moderation,
            max_length,
            rate_limit_per_minute,
            default_nick,
            avatar_cdn,
            display_commenter_user_agent
        );
        if let Some(captcha) = comment.captcha {
            merge!(
                snapshot.comment.captcha,
                captcha,
                pow_enabled,
                pow_difficulty,
                pow_ttl_secs,
                image_enabled,
                image_ttl_secs,
                image_max_attempts,
                bind_ip
            );
        }
        settings_validation::validate_comment_edit(&snapshot.comment)?;
    }
    if let Some(mail) = patch.mail {
        let replacement = mail.password.filter(|value| !value.is_empty());
        if mail.clear_password == Some(true) && replacement.is_some() {
            return Err(AppError::BadRequest(
                "clear_password conflicts with a nonempty password".into(),
            ));
        }
        if mail.clear_password == Some(true) {
            snapshot.mail.password.clear();
            ciphertext = None;
            snapshot.password_needs_reset = false;
        } else if let Some(password) = replacement {
            ciphertext = Some(settings_crypto::encrypt(&password, jwt_secret)?);
            snapshot.mail.password = password;
            snapshot.password_needs_reset = false;
        }
        merge!(
            snapshot.mail,
            mail,
            enabled,
            host,
            port,
            security,
            username,
            from_email,
            from_name,
            admin_email,
            notify_admin,
            notify_reply,
            site_name,
            site_url,
            language
        );
    }
    validate(&snapshot)?;
    let revision = snapshot
        .revision
        .checked_add(1)
        .ok_or_else(|| AppError::internal_msg("settings revision exhausted"))?;
    let content = serde_json::to_string(&Content {
        comment: snapshot.comment.clone(),
        mail: snapshot.mail.clone(),
    })
    .map_err(AppError::internal)?;
    // 单条条件 UPDATE 为比较并交换；并发实例最多一个成功，无读写事务升级锁争用。
    let result = app_settings::Entity::update_many()
        .col_expr(app_settings::Column::Revision, Expr::value(revision))
        .col_expr(app_settings::Column::Content, Expr::value(content))
        .col_expr(
            app_settings::Column::SmtpPasswordCiphertext,
            Expr::value(ciphertext),
        )
        .col_expr(
            app_settings::Column::UpdatedAt,
            Expr::value(Utc::now().naive_utc()),
        )
        .filter(app_settings::Column::Id.eq(1))
        .filter(app_settings::Column::Revision.eq(patch.revision))
        .filter(app_settings::Column::SchemaVersion.eq(1))
        .exec(db)
        .await?;
    if result.rows_affected == 0 {
        return Err(AppError::Conflict(
            "settings were modified; reload before saving".into(),
        ));
    }
    snapshot.revision = revision;
    Ok(snapshot)
}

pub fn response(config: &AppConfig, snapshot: &SettingsSnapshot) -> AdminConfigResponse {
    let c = &snapshot.comment;
    let captcha = &c.captcha;
    let m = &snapshot.mail;
    AdminConfigResponse {
        revision: snapshot.revision,
        comment: CommentConfigResponse {
            moderation: c.moderation,
            max_length: c.max_length,
            rate_limit_per_minute: c.rate_limit_per_minute,
            default_nick: c.default_nick.clone(),
            avatar_cdn: c.avatar_cdn.clone(),
            display_commenter_user_agent: c.display_commenter_user_agent,
            captcha: CaptchaSettingsResponse {
                pow_enabled: captcha.pow_enabled,
                pow_difficulty: captcha.pow_difficulty,
                pow_ttl_secs: captcha.pow_ttl_secs,
                image_enabled: captcha.image_enabled,
                image_ttl_secs: captcha.image_ttl_secs,
                image_max_attempts: captcha.image_max_attempts,
                bind_ip: captcha.bind_ip,
            },
        },
        mail: MailSettingsResponse {
            enabled: m.enabled,
            host: m.host.clone(),
            port: m.port,
            security: m.security.clone(),
            username: m.username.clone(),
            from_email: m.from_email.clone(),
            from_name: m.from_name.clone(),
            admin_email: m.admin_email.clone(),
            notify_admin: m.notify_admin,
            notify_reply: m.notify_reply,
            site_name: m.site_name.clone(),
            site_url: m.site_url.clone(),
            language: m.language.clone(),
            password_configured: snapshot.password_needs_reset || !m.password.is_empty(),
            password_needs_reset: snapshot.password_needs_reset,
        },
        version: env!("CARGO_PKG_VERSION").into(),
        introduction_index: config.static_.introduction_index,
        swagger_ui: config.swagger.enabled,
    }
}

pub struct RuntimeSettings(pub SettingsSnapshot);

impl axum::extract::FromRequestParts<AppState> for RuntimeSettings {
    type Rejection = AppError;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Some(snapshot) = parts.extensions.get::<SettingsSnapshot>() {
            return Ok(Self(snapshot.clone()));
        }
        let snapshot = load(&state.db, &state.config.jwt.secret).await?;
        parts.extensions.insert(snapshot.clone());
        Ok(Self(snapshot))
    }
}

#[cfg(test)]
mod tests;
