//! 创建 comments 表（Valine 替代评论系统）。
//! 使用 sea-query 跨数据库写法，SQLite / PostgreSQL / MySQL 通用。
//! id 用 String 主键（uuid v4 或导入数据的 objectId），保证新旧数据同构、pid/rid 引用一致。

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
                    .table(Comments::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Comments::Id)
                            .string_len(64)
                            .not_null()
                            .primary_key(),
                    )
                    .col(text(Comments::Comment).not_null())
                    .col(string_len(Comments::Nick, 64).not_null())
                    .col(string_len_null(Comments::Mail, 128))
                    .col(string_len_null(Comments::Link, 255))
                    .col(string_len_null(Comments::QqAvatar, 255))
                    .col(string_len(Comments::Url, 255).not_null())
                    .col(string_len_null(Comments::Pid, 64))
                    .col(string_len_null(Comments::Rid, 64))
                    .col(string_len_null(Comments::Ip, 64))
                    .col(string_len_null(Comments::Ua, 512))
                    .col(
                        ColumnDef::new(Comments::IsNotified)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(Comments::Status)
                            .string_len(16)
                            .not_null()
                            .default("approved".to_owned()),
                    )
                    .col(date_time(Comments::InsertedAt).not_null())
                    .col(date_time(Comments::CreatedAt).not_null())
                    .col(date_time(Comments::UpdatedAt).not_null())
                    .to_owned(),
            )
            .await?;

        for (name, col) in [
            ("idx_comments_url", Comments::Url),
            ("idx_comments_status", Comments::Status),
            ("idx_comments_pid", Comments::Pid),
            ("idx_comments_rid", Comments::Rid),
        ] {
            manager
                .create_index(
                    Index::create()
                        .name(name)
                        .table(Comments::Table)
                        .col(col)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Comments::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Comments {
    Table,
    Id,
    Comment,
    Nick,
    Mail,
    Link,
    QqAvatar,
    Url,
    Pid,
    Rid,
    Ip,
    Ua,
    IsNotified,
    Status,
    InsertedAt,
    CreatedAt,
    UpdatedAt,
}
