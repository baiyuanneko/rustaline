//! comments 实体，与 migration/m20260802_000001_create_comment.rs 保持一致。
//! 表名用复数 comments（遵循 AGENTS.md 约定）。

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "comments")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub comment: String,
    pub nick: String,
    pub mail: Option<String>,
    pub link: Option<String>,
    pub qq_avatar: Option<String>,
    pub url: String,
    pub pid: Option<String>,
    pub rid: Option<String>,
    pub ip: Option<String>,
    pub ua: Option<String>,
    pub is_notified: bool,
    pub status: String,
    pub inserted_at: DateTime,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
