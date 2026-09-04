//! 创建 admins 表（单管理员账号，凭据入库）。
//! 仅由启动种子逻辑写入一行；username 唯一。token_version 随改密码自增，
//! JWT claims 携带，用于改密后立即使全部已签发 token 失效。
//! 使用 sea-query 跨数据库写法，SQLite / PostgreSQL / MySQL 通用。

use sea_orm_migration::prelude::*;
use sea_orm_migration::schema::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Admins::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Admins::Id)
                            .string_len(64)
                            .not_null()
                            .primary_key(),
                    )
                    .col(string_len(Admins::Username, 64).not_null().unique_key())
                    // argon2 编码后的 PHC 字符串（~97 字符），255 留足余量
                    .col(string_len(Admins::PasswordHash, 255).not_null())
                    .col(
                        ColumnDef::new(Admins::TokenVersion)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(date_time(Admins::CreatedAt).not_null())
                    .col(date_time(Admins::UpdatedAt).not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Admins::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Admins {
    Table,
    Id,
    Username,
    PasswordHash,
    TokenVersion,
    CreatedAt,
    UpdatedAt,
}
