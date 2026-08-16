//! 删除 users 表：管理员账号改为环境变量（initial_admin 配置）唯一来源，不再落库。
//! down 迁移按 m20260801_000001_create_user 的原始结构重建 users 表。

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Users::Table).if_exists().to_owned())
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
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
