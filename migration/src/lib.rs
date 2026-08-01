pub use sea_orm_migration::prelude::*;

mod m20260801_000001_create_user;

pub struct Migrator;

impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(m20260801_000001_create_user::Migration)]
    }
}
