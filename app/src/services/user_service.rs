//! 用户领域逻辑：CRUD + argon2 密码哈希 + 凭据校验。register 与 users CRUD 复用这里的方法

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, password_hash::rand_core::OsRng};
use chrono::Utc;
use sea_orm::ActiveValue::{NotSet, Set};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::dto::UpdateUserRequest;
use crate::entities::user;
use crate::error::AppError;

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

fn validate_credentials(username: &str, password: &str) -> Result<(), AppError> {
    if username.trim().is_empty() {
        return Err(AppError::BadRequest("username must not be empty".into()));
    }
    if password.len() < 6 {
        return Err(AppError::BadRequest(
            "password must be at least 6 characters".into(),
        ));
    }
    Ok(())
}

pub async fn find_by_username(
    db: &DatabaseConnection,
    username: &str,
) -> Result<Option<user::Model>, AppError> {
    Ok(user::Entity::find()
        .filter(user::Column::Username.eq(username))
        .one(db)
        .await?)
}

pub async fn create_user(
    db: &DatabaseConnection,
    username: &str,
    password: &str,
) -> Result<user::Model, AppError> {
    validate_credentials(username, password)?;

    if find_by_username(db, username).await?.is_some() {
        return Err(AppError::Conflict(format!(
            "username '{username}' is already taken"
        )));
    }

    let now = Utc::now().naive_utc();
    let model = user::ActiveModel {
        id: NotSet,
        username: Set(username.to_owned()),
        password_hash: Set(hash_password(password)?),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;

    Ok(model)
}

/// 校验用户名密码，成功返回用户；用户名不存在或密码错误均返回 Ok(None)
pub async fn verify_credentials(
    db: &DatabaseConnection,
    username: &str,
    password: &str,
) -> Result<Option<user::Model>, AppError> {
    let Some(model) = find_by_username(db, username).await? else {
        return Ok(None);
    };
    if verify_password(password, &model.password_hash)? {
        Ok(Some(model))
    } else {
        Ok(None)
    }
}

/// 启动时种子管理员：账号不存在则创建并返回 true；已存在则跳过返回 false
pub async fn ensure_initial_admin(
    db: &DatabaseConnection,
    username: &str,
    password: &str,
) -> Result<bool, AppError> {
    if find_by_username(db, username).await?.is_some() {
        return Ok(false);
    }
    create_user(db, username, password).await?;
    Ok(true)
}

pub async fn list_users(db: &DatabaseConnection) -> Result<Vec<user::Model>, AppError> {
    Ok(user::Entity::find().all(db).await?)
}

pub async fn get_user(db: &DatabaseConnection, id: i32) -> Result<user::Model, AppError> {
    user::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("user {id} not found")))
}

pub async fn update_user(
    db: &DatabaseConnection,
    id: i32,
    payload: UpdateUserRequest,
) -> Result<user::Model, AppError> {
    let existing = get_user(db, id).await?;

    if let Some(ref username) = payload.username {
        if username.trim().is_empty() {
            return Err(AppError::BadRequest("username must not be empty".into()));
        }
        if username != &existing.username && find_by_username(db, username).await?.is_some() {
            return Err(AppError::Conflict(format!(
                "username '{username}' is already taken"
            )));
        }
    }
    if let Some(ref password) = payload.password
        && password.len() < 6
    {
        return Err(AppError::BadRequest(
            "password must be at least 6 characters".into(),
        ));
    }

    let mut active: user::ActiveModel = existing.into();
    if let Some(username) = payload.username {
        active.username = Set(username);
    }
    if let Some(password) = payload.password {
        active.password_hash = Set(hash_password(&password)?);
    }
    active.updated_at = Set(Utc::now().naive_utc());

    Ok(active.update(db).await?)
}

pub async fn delete_user(db: &DatabaseConnection, id: i32) -> Result<(), AppError> {
    let result = user::Entity::delete_by_id(id).exec(db).await?;
    if result.rows_affected == 0 {
        return Err(AppError::NotFound(format!("user {id} not found")));
    }
    Ok(())
}
