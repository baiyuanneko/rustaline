//! 创建 users 表。使用 sea-query 的跨数据库写法，SQLite / PostgreSQL / MySQL 通用。

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Users::Table)
                    .if_not_exists()
                    .col(pk_auto(Users::Id))
                    .col(string_uniq(Users::Username).not_null())
                    .col(string(Users::PasswordHash).not_null())
                    .col(date_time(Users::CreatedAt).not_null())
                    .col(date_time(Users::UpdatedAt).not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Users::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Id,
    Username,
    PasswordHash,
    CreatedAt,
    UpdatedAt,
}
