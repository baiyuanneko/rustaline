//! 管理员凭据：系统有且仅有一个管理员，凭据落库（admins 表，密码只存 argon2 哈希）。
//! `APP_INITIAL_ADMIN_USERNAME` / `APP_INITIAL_ADMIN_PASSWORD` 仅作首次启动的种子：
//! admins 表为空时种入；已有记录后这两个环境变量被完全忽略。改密码走管理面板
//! （token_version 自增使旧 token 全部失效）。

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, password_hash::rand_core::OsRng};
use chrono::Utc;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use uuid::Uuid;

use crate::config::InitialAdminConfig;
use crate::entities::admins;
use crate::error::AppError;

/// 新密码最小长度（改密码接口与种子共用）
pub const MIN_PASSWORD_LEN: usize = 8;

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(password_hash)?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// 启动种子：admins 表为空时按 initial_admin 配置写入唯一管理员；已有记录则忽略配置。
/// 返回 Ok(true) 表示本次启动执行了种子写入。
pub async fn seed_admin(
    db: &DatabaseConnection,
    initial: &InitialAdminConfig,
) -> Result<bool, Box<dyn std::error::Error>> {
    if admins::Entity::find().one(db).await?.is_some() {
        tracing::info!("admin credentials already seeded; ignoring initial_admin env");
        return Ok(false);
    }

    let (Some(username), Some(password)) = (&initial.username, &initial.password) else {
        return Err(
            "管理员账号未初始化：admins 表为空，必须同时设置 APP_INITIAL_ADMIN_USERNAME 与 APP_INITIAL_ADMIN_PASSWORD 用于首次种子"
                .into(),
        );
    };
    if username.trim().is_empty() || password.is_empty() {
        return Err("管理员账号未初始化：APP_INITIAL_ADMIN_USERNAME / PASSWORD 不能为空".into());
    }
    // 注：种子不校验密码强度——初始密码预期登录后即经管理面板修改；
    // 改密码接口才强制 MIN_PASSWORD_LEN 下限。避免过严的种子校验挡死既有 dev 库升级。

    let now = Utc::now().naive_utc();
    admins::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        username: Set(username.trim().to_owned()),
        password_hash: Set(hash_password(password)?),
        token_version: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    tracing::info!("seeded initial admin account into admins table");
    Ok(true)
}

/// 登录校验：用户名查库 + argon2 比对。任一不符返回 Ok(None)，不泄露用户是否存在。
pub async fn verify_login(
    db: &DatabaseConnection,
    username: &str,
    password: &str,
) -> Result<Option<admins::Model>, AppError> {
    let Some(admin) = admins::Entity::find()
        .filter(admins::Column::Username.eq(username))
        .one(db)
        .await?
    else {
        return Ok(None);
    };
    if !verify_password(password, &admin.password_hash)? {
        return Ok(None);
    }
    Ok(Some(admin))
}

/// 按用户名取管理员（AuthUser 校验 token_version 用）
pub async fn find_by_username(
    db: &DatabaseConnection,
    username: &str,
) -> Result<Option<admins::Model>, AppError> {
    Ok(admins::Entity::find()
        .filter(admins::Column::Username.eq(username))
        .one(db)
        .await?)
}

/// 修改密码：校验当前密码 -> 写新哈希并自增 token_version（旧 token 全部失效）
pub async fn change_password(
    db: &DatabaseConnection,
    username: &str,
    current_password: &str,
    new_password: &str,
) -> Result<(), AppError> {
    if new_password.chars().count() < MIN_PASSWORD_LEN {
        return Err(AppError::BadRequest(format!(
            "new password must be at least {MIN_PASSWORD_LEN} characters"
        )));
    }
    let admin = find_by_username(db, username)
        .await?
        .ok_or_else(|| AppError::Unauthorized("admin account not found".into()))?;
    if !verify_password(current_password, &admin.password_hash)? {
        return Err(AppError::BadRequest("current password incorrect".into()));
    }

    let mut active: admins::ActiveModel = admin.into();
    active.password_hash = Set(hash_password(new_password)?);
    active.token_version = Set(active.token_version.unwrap() + 1);
    active.updated_at = Set(Utc::now().naive_utc());
    active.update(db).await?;
    Ok(())
}
