//! 管理员凭据：唯一管理员账号来自环境变量（initial_admin 配置），不落库。
//! 启动时 argon2 哈希一次密码存内存，login 时校验（保留抗时序攻击特性）。

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, password_hash::rand_core::OsRng};

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

/// 内存中的唯一管理员凭据。密码只存 argon2 哈希
#[derive(Debug, Clone)]
pub struct AdminCredentials {
    pub username: String,
    password_hash: String,
}

impl AdminCredentials {
    pub fn new(username: &str, password: &str) -> Result<Self, AppError> {
        Ok(Self {
            username: username.to_owned(),
            password_hash: hash_password(password)?,
        })
    }

    /// 校验用户名密码；用户名不等或密码不符均返回 Ok(false)
    pub fn verify(&self, username: &str, password: &str) -> Result<bool, AppError> {
        if username != self.username {
            return Ok(false);
        }
        verify_password(password, &self.password_hash)
    }
}
