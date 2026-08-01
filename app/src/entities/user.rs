//! 初始版本为手写实体，与 migration/m20260801_000001_create_user.rs 保持一致。
//! 数据库结构演进后可重新生成：
//!   sea-orm-cli generate entity -o app/src/entities --with-serde none
//! （注意表名为 users，避免与 PostgreSQL 保留字 user 冲突）

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(unique)]
    pub username: String,
    pub password_hash: String,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
