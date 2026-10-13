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
                    .table(AppSettings::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AppSettings::Id)
                            .integer()
                            .not_null()
                            .primary_key(),
                    )
                    .col(integer(AppSettings::SchemaVersion).not_null())
                    .col(big_integer(AppSettings::Revision).not_null())
                    .col(text(AppSettings::Content).not_null())
                    .col(text_null(AppSettings::SmtpPasswordCiphertext))
                    .col(date_time(AppSettings::CreatedAt).not_null())
                    .col(date_time(AppSettings::UpdatedAt).not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AppSettings::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AppSettings {
    Table,
    Id,
    SchemaVersion,
    Revision,
    Content,
    SmtpPasswordCiphertext,
    CreatedAt,
    UpdatedAt,
}
