use sea_orm_migration::cli;

#[tokio::main]
async fn main() {
    // 用法（环境变量 DATABASE_URL 指定目标库）：
    //   cargo run -p migration -- up
    //   cargo run -p migration -- down
    //   cargo run -p migration -- fresh
    cli::run_cli(migration::Migrator).await;
}
