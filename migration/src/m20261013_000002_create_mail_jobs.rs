use sea_orm_migration::prelude::*;
use sea_orm_migration::schema::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Comments::Table)
                    .add_column(
                        boolean(Comments::ReplyNotification)
                            .not_null()
                            .default(true),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MailJobs::Table)
                    .col(string_len(MailJobs::Id, 64).not_null().primary_key())
                    .col(string_len(MailJobs::EventKey, 128).not_null().unique_key())
                    .col(string_len(MailJobs::Kind, 16).not_null())
                    .col(string_len(MailJobs::CommentId, 64).not_null())
                    .col(string_len_null(MailJobs::ParentId, 64))
                    .col(string_len(MailJobs::Recipient, 254).not_null())
                    .col(string_len(MailJobs::Status, 32).not_null())
                    .col(integer(MailJobs::Attempts).not_null().default(0))
                    .col(date_time(MailJobs::NextAttemptAt).not_null())
                    .col(string_len_null(MailJobs::LeaseToken, 64))
                    .col(date_time_null(MailJobs::LeaseUntil))
                    .col(string_len_null(MailJobs::LastError, 64))
                    .col(date_time(MailJobs::CreatedAt).not_null())
                    .col(date_time(MailJobs::UpdatedAt).not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_mail_jobs_due")
                    .table(MailJobs::Table)
                    .col(MailJobs::Status)
                    .col(MailJobs::NextAttemptAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_mail_jobs_lease")
                    .table(MailJobs::Table)
                    .col(MailJobs::Status)
                    .col(MailJobs::LeaseUntil)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_mail_jobs_comment")
                    .table(MailJobs::Table)
                    .col(MailJobs::CommentId)
                    .to_owned(),
            )
            .await
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MailJobs::Table).to_owned())
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Comments::Table)
                    .drop_column(Comments::ReplyNotification)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Comments {
    Table,
    ReplyNotification,
}
#[derive(DeriveIden)]
enum MailJobs {
    Table,
    Id,
    EventKey,
    Kind,
    CommentId,
    ParentId,
    Recipient,
    Status,
    Attempts,
    NextAttemptAt,
    LeaseToken,
    LeaseUntil,
    LastError,
    CreatedAt,
    UpdatedAt,
}
