use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "mail_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub event_key: String,
    pub kind: String,
    pub comment_id: String,
    pub parent_id: Option<String>,
    pub recipient: String,
    pub status: String,
    pub attempts: i32,
    pub next_attempt_at: DateTime,
    pub lease_token: Option<String>,
    pub lease_until: Option<DateTime>,
    pub last_error: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
