//! admins 实体，与 migration/m20260903_000001_create_admin.rs 保持一致。
//! 单管理员：全表只有一行（由启动种子写入），username 唯一。

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "admins")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub username: String,
    /// argon2 哈希；实体从不直接序列化出 API（一律经 DTO 转换），不会外泄
    pub password_hash: String,
    /// 改密码时自增；JWT claims 携带，不一致即视为 token 已失效
    pub token_version: i32,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
