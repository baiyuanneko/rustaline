use super::*;
use migration::{Migrator, MigratorTrait};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DbBackend, PaginatorTrait, Statement};

#[test]
fn seed_insert_sql_preserves_mysql_and_other_backend_conflict_semantics() {
    use sea_orm::QueryTrait;
    let model = app_settings::ActiveModel {
        id: Set(1),
        ..Default::default()
    };
    let mysql = seed_insert(model.clone())
        .build(DbBackend::MySql)
        .to_string();
    assert!(
        mysql.ends_with("ON DUPLICATE KEY UPDATE `id` = `id`"),
        "{mysql}"
    );
    for backend in [DbBackend::Sqlite, DbBackend::Postgres] {
        let sql = seed_insert(model.clone()).build(backend).to_string();
        assert!(sql.ends_with("ON CONFLICT (\"id\") DO NOTHING"), "{sql}");
    }
}

#[tokio::test]
async fn captcha_ttl_uses_a_stable_supported_lifetime() {
    let db = database().await;
    let config = bootstrap();
    initialize(&db, &config).await.unwrap();
    let invalid = serde_json::from_value(serde_json::json!({
        "revision": 1, "comment": {"captcha": {"pow_ttl_secs": 31_536_001}}
    }))
    .unwrap();
    assert!(matches!(
        update(&db, &config.jwt.secret, invalid).await,
        Err(AppError::BadRequest(_))
    ));
    let valid = serde_json::from_value(serde_json::json!({
        "revision": 1, "comment": {"captcha": {"pow_ttl_secs": 31_536_000, "image_ttl_secs": 31_536_000}}
    })).unwrap();
    update(&db, &config.jwt.secret, valid).await.unwrap();
    let restarted = initialize(&db, &config).await.unwrap();
    assert_eq!(restarted.comment.captcha.pow_ttl_secs, 31_536_000);
}

async fn database() -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1);
    let db = Database::connect(options).await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    db
}

fn bootstrap() -> AppConfig {
    config::Config::builder()
        .add_source(config::File::from_str(
            include_str!("../../../../config/default.toml"),
            config::FileFormat::Toml,
        ))
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap()
}

#[tokio::test]
async fn initialization_is_idempotent_and_restart_reads_database() {
    let db = database().await;
    let mut config = bootstrap();
    config.comment.moderation = true;
    config.comment.captcha.secret = "deployment-secret".into();
    config.mail.password = "smtp-secret".into();
    config.mail.username = "smtp-user".into();
    let first = initialize(&db, &config).await.unwrap();
    assert_eq!(first.revision, 1);
    assert!(first.comment.moderation);
    config.comment.moderation = false;
    config.comment.max_length = 0;
    let second = initialize(&db, &config).await.unwrap();
    assert!(second.comment.moderation);
    assert_eq!(second.comment.max_length, 10000);
    assert_eq!(second.mail.password, "smtp-secret");
    let row = app_settings::Entity::find_by_id(1)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(!row.content.contains("smtp-secret"));
    assert!(!row.content.contains("deployment-secret"));
    assert!(!row.content.contains("password"));
    assert!(!row.content.contains("secret"));
    assert!(
        !row.smtp_password_ciphertext
            .unwrap()
            .contains("smtp-secret")
    );
    assert!(!format!("{:?}", second.mail).contains("smtp-secret"));
}

#[tokio::test]
async fn concurrent_initialization_creates_one_row() {
    let db = database().await;
    let config = bootstrap();
    let (left, right) = tokio::join!(initialize(&db, &config), initialize(&db, &config));
    assert_eq!(left.unwrap().revision, 1);
    assert_eq!(right.unwrap().revision, 1);
    assert_eq!(app_settings::Entity::find().count(&db).await.unwrap(), 1);
}

#[tokio::test]
async fn defaults_fill_missing_fields_and_future_schema_is_rejected() {
    let db = database().await;
    let config = bootstrap();
    initialize(&db, &config).await.unwrap();
    app_settings::Entity::update_many()
        .col_expr(
            app_settings::Column::Content,
            Expr::value(r#"{"comment":{"moderation":true}}"#),
        )
        .filter(app_settings::Column::Id.eq(1))
        .exec(&db)
        .await
        .unwrap();
    let snapshot = load(&db, &config.jwt.secret).await.unwrap();
    assert!(snapshot.comment.moderation);
    assert_eq!(snapshot.comment.max_length, 10000);
    assert_eq!(snapshot.mail.port, 587);
    assert_eq!(snapshot.mail.security, "starttls");
    assert_eq!(snapshot.mail.language, "zh-CN");
    app_settings::Entity::update_many()
        .col_expr(app_settings::Column::SchemaVersion, Expr::value(2))
        .filter(app_settings::Column::Id.eq(1))
        .exec(&db)
        .await
        .unwrap();
    assert!(initialize(&db, &config).await.is_err());
    assert_eq!(
        app_settings::Entity::find_by_id(1)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .schema_version,
        2
    );
}

#[tokio::test]
async fn changed_jwt_secret_preserves_password_ciphertext_until_replaced_or_cleared() {
    let db = database().await;
    let mut config = bootstrap();
    config.mail.username = "smtp-user".into();
    config.mail.password = " first secret ".into();
    initialize(&db, &config).await.unwrap();
    let cipher = app_settings::Entity::find_by_id(1)
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .smtp_password_ciphertext;
    let changed_secret = "different-jwt-secret";
    let snapshot = load(&db, changed_secret).await.unwrap();
    assert!(snapshot.password_needs_reset);
    assert!(snapshot.mail.password.is_empty());
    let patch =
        serde_json::from_value(serde_json::json!({"revision":1,"mail":{"site_name":"Updated"}}))
            .unwrap();
    let updated = update(&db, changed_secret, patch).await.unwrap();
    assert!(updated.password_needs_reset);
    assert_eq!(
        app_settings::Entity::find_by_id(1)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .smtp_password_ciphertext,
        cipher
    );
    let patch = serde_json::from_value(
        serde_json::json!({"revision":2,"mail":{"password":"new password"}}),
    )
    .unwrap();
    let updated = update(&db, changed_secret, patch).await.unwrap();
    assert!(!updated.password_needs_reset);
    assert_eq!(updated.mail.password, "new password");
    let patch =
        serde_json::from_value(serde_json::json!({"revision":3,"mail":{"clear_password":true}}))
            .unwrap();
    assert!(
        update(&db, changed_secret, patch)
            .await
            .unwrap()
            .mail
            .password
            .is_empty()
    );
    assert!(
        app_settings::Entity::find_by_id(1)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .smtp_password_ciphertext
            .is_none()
    );
}

#[tokio::test]
async fn conditional_update_allows_only_one_writer() {
    let db = database().await;
    let config = bootstrap();
    initialize(&db, &config).await.unwrap();
    let left =
        serde_json::from_value(serde_json::json!({"revision":1,"comment":{"moderation":true}}))
            .unwrap();
    let right =
        serde_json::from_value(serde_json::json!({"revision":1,"comment":{"moderation":false}}))
            .unwrap();
    let (left, right) = tokio::join!(
        update(&db, &config.jwt.secret, left),
        update(&db, &config.jwt.secret, right)
    );
    assert_eq!(usize::from(left.is_ok()) + usize::from(right.is_ok()), 1);
    let rejected = left.err().or(right.err()).unwrap();
    assert!(matches!(rejected, AppError::Conflict(_)));
    assert_eq!(load(&db, &config.jwt.secret).await.unwrap().revision, 2);
}

#[tokio::test]
async fn redis_expiration_overflow_is_rejected_before_saving() {
    let db = database().await;
    let config = bootstrap();
    initialize(&db, &config).await.unwrap();
    for field in ["pow_ttl_secs", "image_ttl_secs"] {
        let patch = serde_json::from_value(serde_json::json!({
            "revision": 1,
            "comment": {"captcha": {field: 9_223_372_036_854_775_u64}}
        }))
        .unwrap();
        assert!(matches!(
            update(&db, &config.jwt.secret, patch).await,
            Err(AppError::BadRequest(_))
        ));
    }
    assert_eq!(load(&db, &config.jwt.secret).await.unwrap().revision, 1);
}

#[tokio::test]
async fn legacy_zero_length_and_empty_nickname_survive_upgrade_and_mail_edits() {
    let db = database().await;
    let mut config = bootstrap();
    config.comment.max_length = 0;
    config.comment.default_nick.clear();
    let first = initialize(&db, &config).await.unwrap();
    assert_eq!(first.comment.max_length, 0);
    assert!(first.comment.default_nick.is_empty());
    let patch = serde_json::from_value(serde_json::json!({
        "revision": 1, "mail": {"site_name": "Updated"}
    }))
    .unwrap();
    update(&db, &config.jwt.secret, patch).await.unwrap();
    let restarted = initialize(&db, &config).await.unwrap();
    assert_eq!(restarted.comment.max_length, 0);
    assert!(restarted.comment.default_nick.is_empty());
    let patch = serde_json::from_value(serde_json::json!({
        "revision": 2, "comment": {"moderation": true}
    }))
    .unwrap();
    assert!(matches!(
        update(&db, &config.jwt.secret, patch).await,
        Err(AppError::BadRequest(_))
    ));
}

#[tokio::test]
async fn upgrade_preserves_existing_comments_and_admin_credentials() {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1);
    let db = Database::connect(options).await.unwrap();
    Migrator::up(&db, Some(4)).await.unwrap();
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,
        "INSERT INTO comments (id, comment, nick, url, inserted_at, created_at, updated_at) VALUES ('old-comment', 'kept body', 'Old author', '/old', '2026-10-01 00:00:00', '2026-10-01 00:00:00', '2026-10-01 00:00:00')")).await.unwrap();
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,
        "INSERT INTO admins (id, username, password_hash, token_version, created_at, updated_at) VALUES ('old-admin', 'original-admin', 'original-password-hash', 7, '2026-10-01 00:00:00', '2026-10-01 00:00:00')")).await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    let mut config = bootstrap();
    config.comment.default_nick = "Migrated nickname".into();
    initialize(&db, &config).await.unwrap();
    let comment = crate::entities::comments::Entity::find_by_id("old-comment")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(comment.comment, "kept body");
    let admin = crate::entities::admins::Entity::find_by_id("old-admin")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(admin.username, "original-admin");
    assert_eq!(admin.password_hash, "original-password-hash");
    assert_eq!(admin.token_version, 7);
    assert_eq!(
        load(&db, &config.jwt.secret)
            .await
            .unwrap()
            .comment
            .default_nick,
        "Migrated nickname"
    );
}

#[tokio::test]
async fn password_encryption_uses_random_nonce_and_preserves_exact_whitespace() {
    let db = database().await;
    let config = bootstrap();
    initialize(&db, &config).await.unwrap();
    let patch = serde_json::from_value(
        serde_json::json!({"revision":1,"mail":{"username":"user","password":"  same password  "}}),
    )
    .unwrap();
    update(&db, &config.jwt.secret, patch).await.unwrap();
    let first = app_settings::Entity::find_by_id(1)
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .smtp_password_ciphertext;
    let patch = serde_json::from_value(
        serde_json::json!({"revision":2,"mail":{"password":"  same password  "}}),
    )
    .unwrap();
    update(&db, &config.jwt.secret, patch).await.unwrap();
    let second = app_settings::Entity::find_by_id(1)
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .smtp_password_ciphertext;
    assert_ne!(first, second);
    assert_eq!(
        load(&db, &config.jwt.secret).await.unwrap().mail.password,
        "  same password  "
    );
    let patch =
        serde_json::from_value(serde_json::json!({"revision":3,"mail":{"password":""}})).unwrap();
    update(&db, &config.jwt.secret, patch).await.unwrap();
    assert_eq!(
        app_settings::Entity::find_by_id(1)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .smtp_password_ciphertext,
        second
    );
}
