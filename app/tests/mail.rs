//! 邮件用例仅连接本机 TCP 假 SMTP，不向外部邮箱发送。
use app::config::{AppConfig, CaptchaConfig};
use app::dto::{CommentCreateRequest, CommentPublicResponse, CommentStatusUpdate};
use app::entities::{comments, mail_jobs};
use app::services::{
    captcha_service::CaptchaMemoryStore,
    comment_service, import_service,
    mail_queue::{self, Outcome},
    mail_service, mail_worker, settings_service,
};
use chrono::{Duration, Utc};
use migration::{Migrator, MigratorTrait};
use sea_orm::{
    ColumnTrait, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, sea_query::Expr,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    sync::{Mutex, Notify, Semaphore},
};

struct Smtp {
    port: u16,
    messages: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Smtp {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn smtp(reject: bool) -> Smtp {
    smtp_with_gate(reject, None).await
}

async fn smtp_with_gate(reject: bool, gate: Option<(Arc<Notify>, Arc<Semaphore>)>) -> Smtp {
    smtp_behavior(reject, gate, false).await
}

async fn smtp_behavior(
    reject: bool,
    gate: Option<(Arc<Notify>, Arc<Semaphore>)>,
    slow_quit: bool,
) -> Smtp {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let messages = Arc::new(Mutex::new(Vec::new()));
    let inbox = messages.clone();
    let task = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let inbox = inbox.clone();
            let gate = gate.clone();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                write.write_all(b"220 localhost SMTP\r\n").await.unwrap();
                let mut lines = BufReader::new(read).lines();
                let mut data = false;
                let mut body = String::new();
                while let Ok(Some(line)) = lines.next_line().await {
                    if data {
                        if line == "." {
                            if let Some((entered, proceed)) = &gate {
                                entered.notify_one();
                                let _ = proceed.acquire().await.unwrap();
                            }
                            inbox.lock().await.push(body.clone());
                            data = false;
                            if write.write_all(b"250 accepted\r\n").await.is_err() {
                                break;
                            }
                        } else {
                            body.push_str(&line);
                            body.push('\n');
                        }
                    } else {
                        let command = line.to_ascii_uppercase();
                        let response = if command.starts_with("EHLO") {
                            "250-localhost\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n"
                        } else if command.starts_with("DATA") {
                            data = true;
                            body.clear();
                            "354 send data\r\n"
                        } else if command.starts_with("AUTH") {
                            if reject {
                                "535 authentication refused secret-password smtp-private-detail\r\n"
                            } else {
                                "235 authenticated\r\n"
                            }
                        } else if reject && command.starts_with("MAIL FROM") {
                            "550 secret-password smtp-private-detail\r\n"
                        } else if command.starts_with("QUIT") {
                            if slow_quit {
                                tokio::time::sleep(std::time::Duration::from_secs(40)).await;
                            }
                            let _ = write.write_all(b"221 bye\r\n").await;
                            break;
                        } else {
                            "250 ok\r\n"
                        };
                        if write.write_all(response.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                }
            });
        }
    });
    Smtp {
        port,
        messages,
        task,
    }
}

#[tokio::test]
async fn accepted_email_with_stalled_quit_is_successful_within_total_timeout() {
    let server = smtp_behavior(false, None, true).await;
    let config = config(server.port);
    let db = setup(&config).await;
    create(&db, &config, json!({})).await;
    let started = std::time::Instant::now();
    assert!(
        mail_worker::process_once(&db, &config.jwt.secret)
            .await
            .unwrap()
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(33));
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.status, "sent");
    assert_eq!(job.attempts, 1);
    assert_eq!(server.messages.lock().await.len(), 1);
    assert!(
        !mail_worker::process_once(&db, &config.jwt.secret)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn stalled_smtp_data_times_out_and_consumes_exactly_one_attempt() {
    let entered = Arc::new(Notify::new());
    let proceed = Arc::new(Semaphore::new(0));
    let server = smtp_with_gate(false, Some((entered, proceed))).await;
    let config = config(server.port);
    let db = setup(&config).await;
    create(&db, &config, json!({})).await;
    let started = std::time::Instant::now();
    assert!(
        mail_worker::process_once(&db, &config.jwt.secret)
            .await
            .unwrap()
    );
    assert!(started.elapsed() >= std::time::Duration::from_secs(29));
    assert!(started.elapsed() < std::time::Duration::from_secs(33));
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.status, "pending");
    assert_eq!(job.attempts, 1);
    assert_eq!(job.last_error.as_deref(), Some("smtp_timeout"));
    assert!(server.messages.lock().await.is_empty());
}

#[tokio::test]
async fn nested_reply_only_notifies_direct_parent_and_unique_event_is_idempotent() {
    let server = smtp(false).await;
    let mut config = config(server.port);
    config.mail.notify_admin = false;
    let db = setup(&config).await;
    let root = create(&db, &config, json!({"mail":"root@example.test"})).await;
    let parent = create(
        &db,
        &config,
        json!({"pid":root.id,"mail":"parent@example.test"}),
    )
    .await;
    drain(&db, &config).await;
    let nested = create(
        &db,
        &config,
        json!({"pid":parent.id,"mail":"nested@example.test"}),
    )
    .await;
    let model = comments::Entity::find_by_id(&nested.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    mail_queue::enqueue_new_comment(&db, &config.mail, &model)
        .await
        .unwrap();
    assert_eq!(
        mail_jobs::Entity::find()
            .filter(mail_jobs::Column::CommentId.eq(&nested.id))
            .count(&db)
            .await
            .unwrap(),
        1
    );
    drain(&db, &config).await;
    let messages = server.messages.lock().await;
    assert_eq!(messages.len(), 2);
    assert!(messages.last().unwrap().contains("To: parent@example.test"));
}

#[tokio::test]
async fn moderation_roundtrip_during_smtp_keeps_lease_and_does_not_double_send() {
    let entered = Arc::new(Notify::new());
    let proceed = Arc::new(Semaphore::new(0));
    let server = smtp_with_gate(false, Some((entered.clone(), proceed.clone()))).await;
    let mut config = config(server.port);
    config.mail.notify_admin = false;
    let db = setup(&config).await;
    let parent = create(&db, &config, json!({"mail":"parent@example.test"})).await;
    let reply = create(&db, &config, json!({"pid":parent.id})).await;
    let sending_db = db.clone();
    let key = config.jwt.secret.clone();
    let sending = tokio::spawn(async move { mail_worker::process_once(&sending_db, &key).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    for status in ["pending", "approved"] {
        comment_service::update_status(
            &db,
            &config.comment,
            &reply.id,
            CommentStatusUpdate {
                status: status.into(),
            },
        )
        .await
        .unwrap();
    }
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.status, "processing");
    assert!(job.lease_token.is_some());
    assert!(
        !mail_worker::process_once(&db, &config.jwt.secret)
            .await
            .unwrap()
    );
    proceed.add_permits(1);
    assert!(sending.await.unwrap().unwrap());
    assert_eq!(server.messages.lock().await.len(), 1);
    assert_eq!(
        mail_jobs::Entity::find()
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "sent"
    );
    assert!(
        comments::Entity::find_by_id(&reply.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .is_notified
    );
}

#[tokio::test]
async fn persistent_database_restart_recovers_expired_inflight_event() {
    let server = smtp(false).await;
    let config = config(server.port);
    let path = std::env::temp_dir().join(format!("rustaline-mail-{}.db", uuid::Uuid::new_v4()));
    let db_url = format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );
    let db = Database::connect(&db_url).await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    settings_service::initialize(&db, &config).await.unwrap();
    create(&db, &config, json!({})).await;
    mail_queue::claim(&db, Utc::now().naive_utc() - Duration::seconds(121))
        .await
        .unwrap();
    // 模拟旧进程已领取、租约过期后退出。
    mail_jobs::Entity::update_many()
        .col_expr(mail_jobs::Column::Status, Expr::value("processing"))
        .col_expr(mail_jobs::Column::LeaseToken, Expr::value("old-process"))
        .col_expr(
            mail_jobs::Column::LeaseUntil,
            Expr::value(Utc::now().naive_utc() - Duration::seconds(1)),
        )
        .exec(&db)
        .await
        .unwrap();
    db.close().await.unwrap();
    let db = Database::connect(&db_url).await.unwrap();
    drain(&db, &config).await;
    assert_eq!(server.messages.lock().await.len(), 1);
    assert_eq!(
        mail_jobs::Entity::find()
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "sent"
    );
    db.close().await.unwrap();
    std::fs::remove_file(path).unwrap();
}

fn config(port: u16) -> AppConfig {
    let mut config: AppConfig = config::Config::builder()
        .add_source(config::File::from_str(
            include_str!("../../config/default.toml"),
            config::FileFormat::Toml,
        ))
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();
    config.comment.captcha = CaptchaConfig {
        pow_enabled: false,
        image_enabled: false,
        ..Default::default()
    };
    config.mail.enabled = true;
    config.mail.host = "127.0.0.1".into();
    config.mail.port = port;
    config.mail.security = "none".into();
    config.mail.from_email = "sender@example.test".into();
    config.mail.admin_email = "admin@example.test".into();
    config.mail.notify_admin = true;
    config.mail.notify_reply = true;
    config.mail.site_name = "测试站点".into();
    config.mail.site_url = "https://example.test".into();
    config
}

async fn setup(config: &AppConfig) -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1);
    let db = Database::connect(options).await.unwrap();
    Migrator::up(&db, None).await.unwrap();
    settings_service::initialize(&db, config).await.unwrap();
    db
}

async fn create(
    db: &DatabaseConnection,
    config: &AppConfig,
    fields: Value,
) -> CommentPublicResponse {
    let mut body =
        json!({"url":"/article", "comment":"hello <script>not html</script>", "nick":"Alice"});
    body.as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    let payload: CommentCreateRequest = serde_json::from_value(body).unwrap();
    comment_service::create_comment(
        db,
        &None,
        &CaptchaMemoryStore::new(),
        &[],
        &config.comment,
        &config.mail,
        payload,
        "127.0.0.1".into(),
        None,
    )
    .await
    .unwrap()
}

async fn drain(db: &DatabaseConnection, config: &AppConfig) {
    for _ in 0..20 {
        if !mail_worker::process_once(db, &config.jwt.secret)
            .await
            .unwrap()
        {
            return;
        }
    }
    panic!("queue did not drain");
}

async fn patch(db: &DatabaseConnection, config: &AppConfig, mail: Value) {
    let current = settings_service::load(db, &config.jwt.secret)
        .await
        .unwrap();
    settings_service::update(
        db,
        &config.jwt.secret,
        serde_json::from_value(json!({"revision":current.revision, "mail":mail})).unwrap(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn new_comment_persists_admin_event_in_same_database() {
    let server = smtp(false).await;
    let config = config(server.port);
    let db = setup(&config).await;
    let comment = create(&db, &config, json!({})).await;
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.event_key, format!("admin:{}", comment.id));
    assert!(server.messages.lock().await.is_empty());
    drain(&db, &config).await;
    let messages = server.messages.lock().await;
    assert_eq!(messages.len(), 1);
    assert!(messages[0].contains(&format!("<{}@rustaline.local>", job.id)));
    assert!(messages[0].contains("Content-Type: text/plain"));
    assert!(messages[0].contains("hello <script>not html</script>"));
    let status = mail_queue::status(&db).await.unwrap();
    assert_eq!(status.pending, 0);
    assert_eq!(status.failed, 0);
    assert!(status.last_success_at.is_some());
}

#[tokio::test]
async fn pending_reply_waits_for_approval_and_repeated_approval_never_requeues() {
    let server = smtp(false).await;
    let mut config = config(server.port);
    let db = setup(&config).await;
    let parent = create(&db, &config, json!({"mail":"parent@example.test"})).await;
    drain(&db, &config).await;
    config.comment.moderation = true;
    let reply = create(
        &db,
        &config,
        json!({"pid":parent.id, "mail":"reply@example.test"}),
    )
    .await;
    drain(&db, &config).await;
    assert_eq!(
        server.messages.lock().await.len(),
        2,
        "admin pending reminder should send"
    );
    assert_eq!(
        mail_jobs::Entity::find()
            .filter(mail_jobs::Column::Status.eq("waiting_approval"))
            .count(&db)
            .await
            .unwrap(),
        1
    );
    for _ in 0..2 {
        comment_service::update_status(
            &db,
            &config.comment,
            &reply.id,
            CommentStatusUpdate {
                status: "approved".into(),
            },
        )
        .await
        .unwrap();
        drain(&db, &config).await;
    }
    assert_eq!(server.messages.lock().await.len(), 3);
    assert!(
        server
            .messages
            .lock()
            .await
            .last()
            .unwrap()
            .contains("parent@example.test")
    );
    assert!(
        comments::Entity::find_by_id(&reply.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .is_notified
    );
    mail_jobs::Entity::update_many()
        .col_expr(
            mail_jobs::Column::UpdatedAt,
            Expr::value(Utc::now().naive_utc() - Duration::days(31)),
        )
        .exec(&db)
        .await
        .unwrap();
    mail_queue::cleanup(&db, Utc::now().naive_utc())
        .await
        .unwrap();
    comment_service::update_status(
        &db,
        &config.comment,
        &reply.id,
        CommentStatusUpdate {
            status: "approved".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(mail_jobs::Entity::find().count(&db).await.unwrap(), 0);
}

#[tokio::test]
async fn preferences_empty_invalid_and_self_email_skip_reply_events() {
    let config = config(1);
    let db = setup(&config).await;
    for fields in [
        json!({}),
        json!({"mail":"parent@example.test", "reply_notification":false}),
        json!({"mail":"SAME@example.test"}),
    ] {
        let parent = create(&db, &config, fields).await;
        create(
            &db,
            &config,
            json!({"pid":parent.id, "mail":"same@example.test"}),
        )
        .await;
    }
    let parent = create(&db, &config, json!({"mail":"parent@example.test"})).await;
    comments::Entity::update_many()
        .col_expr(comments::Column::Mail, Expr::value("invalid-email"))
        .filter(comments::Column::Id.eq(&parent.id))
        .exec(&db)
        .await
        .unwrap();
    create(&db, &config, json!({"pid":parent.id})).await;
    assert_eq!(
        mail_jobs::Entity::find()
            .filter(mail_jobs::Column::Kind.eq("reply"))
            .count(&db)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn import_honeypot_and_old_approval_do_not_create_events() {
    let config = config(1);
    let db = setup(&config).await;
    create(&db, &config, json!({"hp":"bot"})).await;
    import_service::import_valine(&db, json!([{"objectId":"old", "comment":"imported", "url":"/article", "mail":"old@example.test", "isNotified":true}])).await.unwrap();
    comment_service::update_status(
        &db,
        &config.comment,
        "old",
        CommentStatusUpdate {
            status: "approved".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(mail_jobs::Entity::find().count(&db).await.unwrap(), 0);
    let old = comments::Entity::find_by_id("old")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(old.reply_notification);
    assert!(old.is_notified);
}

#[tokio::test]
async fn smtp_rejection_is_redacted_and_retries_exactly_five_times() {
    let server = smtp(true).await;
    let config = config(server.port);
    let db = setup(&config).await;
    create(&db, &config, json!({})).await;
    for attempt in 1..=5 {
        assert!(
            mail_worker::process_once(&db, &config.jwt.secret)
                .await
                .unwrap()
        );
        let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
        assert_eq!(job.attempts, attempt);
        assert_eq!(job.last_error.as_deref(), Some("smtp_rejected"));
        assert_eq!(job.status, if attempt == 5 { "failed" } else { "pending" });
        if attempt < 5 {
            assert_eq!(
                (job.next_attempt_at - job.updated_at).num_seconds(),
                [30, 120, 600, 1800][(attempt - 1) as usize]
            );
            assert!(
                !mail_worker::process_once(&db, &config.jwt.secret)
                    .await
                    .unwrap()
            );
            mail_jobs::Entity::update_many()
                .col_expr(
                    mail_jobs::Column::NextAttemptAt,
                    Expr::value(Utc::now().naive_utc() - Duration::seconds(1)),
                )
                .exec(&db)
                .await
                .unwrap();
        }
    }
    assert_eq!(mail_queue::status(&db).await.unwrap().failed, 1);
    assert!(server.messages.lock().await.is_empty());
}

#[tokio::test]
async fn disabled_smtp_and_broken_password_pause_without_consuming_attempts() {
    let server = smtp(false).await;
    let mut config = config(server.port);
    config.mail.username = "local-user".into();
    config.mail.password = "local-secret".into();
    let db = setup(&config).await;
    create(&db, &config, json!({})).await;
    patch(&db, &config, json!({"enabled":false})).await;
    assert!(
        !mail_worker::process_once(&db, &config.jwt.secret)
            .await
            .unwrap()
    );
    patch(&db, &config, json!({"enabled":true})).await;
    assert!(
        !mail_worker::process_once(&db, "changed-jwt-key")
            .await
            .unwrap()
    );
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.status, "pending");
    assert_eq!(job.attempts, 0);
    assert!(server.messages.lock().await.is_empty());
}

#[tokio::test]
async fn conditional_claim_has_one_owner_and_recovers_expired_lease() {
    let config = config(1);
    let db = setup(&config).await;
    create(&db, &config, json!({})).await;
    let now = Utc::now().naive_utc();
    let (left, right) = tokio::join!(mail_queue::claim(&db, now), mail_queue::claim(&db, now));
    let owners = [left.unwrap(), right.unwrap()];
    assert_eq!(owners.iter().filter(|job| job.is_some()).count(), 1);
    let first = owners.into_iter().flatten().next().unwrap();
    assert!(
        mail_queue::claim(&db, now + Duration::seconds(119))
            .await
            .unwrap()
            .is_none()
    );
    let second = mail_queue::claim(&db, now + Duration::seconds(121))
        .await
        .unwrap()
        .unwrap();
    assert_ne!(first.lease_token, second.lease_token);
    assert!(
        !mail_queue::finish(&db, &first, Outcome::Sent, now)
            .await
            .unwrap()
    );
    assert!(
        mail_queue::finish(&db, &second, Outcome::Paused, now)
            .await
            .unwrap()
    );
    assert_eq!(
        mail_jobs::Entity::find()
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .attempts,
        0
    );
}

#[tokio::test]
async fn delete_spam_and_disabled_notifications_cancel_pending_events() {
    let server = smtp(false).await;
    let config = config(server.port);
    let db = setup(&config).await;
    let removed = create(&db, &config, json!({})).await;
    comment_service::delete_comment(&db, &removed.id)
        .await
        .unwrap();
    let spam = create(&db, &config, json!({})).await;
    comment_service::update_status(
        &db,
        &config.comment,
        &spam.id,
        CommentStatusUpdate {
            status: "spam".into(),
        },
    )
    .await
    .unwrap();
    create(&db, &config, json!({})).await;
    patch(&db, &config, json!({"notify_admin":false})).await;
    drain(&db, &config).await;
    assert_eq!(
        mail_jobs::Entity::find()
            .filter(mail_jobs::Column::Status.eq("cancelled"))
            .count(&db)
            .await
            .unwrap(),
        3
    );
    assert!(server.messages.lock().await.is_empty());
}

#[tokio::test]
async fn comment_and_enqueue_rollback_together_on_queue_failure() {
    let config = config(1);
    let db = setup(&config).await;
    db.execute_unprepared("DROP TABLE mail_jobs").await.unwrap();
    let payload = serde_json::from_value(json!({"url":"/article", "comment":"atomic"})).unwrap();
    assert!(
        comment_service::create_comment(
            &db,
            &None,
            &CaptchaMemoryStore::new(),
            &[],
            &config.comment,
            &config.mail,
            payload,
            "127.0.0.1".into(),
            None
        )
        .await
        .is_err()
    );
    assert_eq!(comments::Entity::find().count(&db).await.unwrap(), 0);
}

#[tokio::test]
async fn test_email_uses_saved_config_and_reports_redacted_errors() {
    let server = smtp(false).await;
    let config = config(server.port);
    let db = setup(&config).await;
    let settings = settings_service::RuntimeSettings(
        settings_service::load(&db, &config.jwt.secret)
            .await
            .unwrap(),
    );
    mail_service::send_test(
        &settings,
        serde_json::from_value(json!({"to":"test@example.test"})).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(server.messages.lock().await.len(), 1);
    assert_eq!(mail_jobs::Entity::find().count(&db).await.unwrap(), 0);
    let rejecting = smtp(true).await;
    patch(&db, &config, json!({"port":rejecting.port})).await;
    let settings = settings_service::RuntimeSettings(
        settings_service::load(&db, &config.jwt.secret)
            .await
            .unwrap(),
    );
    let error = mail_service::send_test(
        &settings,
        serde_json::from_value(json!({"to":"test@example.test"})).unwrap(),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("smtp_rejected"));
    assert!(!error.contains("smtp-private-detail"));
    assert!(!error.contains("secret-password"));
}

#[tokio::test]
async fn mail_http_endpoints_require_authentication_and_expose_expected_status_shape() {
    use app::{middleware::rate_limit::RateLimiter, routes::create_router, state::AppState};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let server = smtp(false).await;
    let mut config = config(server.port);
    config.jwt.blacklist_enabled = false;
    config.initial_admin.username = Some("admin".into());
    config.initial_admin.password = Some("adminpass123".into());
    let db = setup(&config).await;
    app::auth::admin::seed_admin(&db, &config.initial_admin)
        .await
        .unwrap();
    let state = AppState {
        db,
        redis: None,
        config: Arc::new(config),
        comment_rate_limiter: RateLimiter::new(),
        login_rate_limiter: RateLimiter::new(),
        pow_issue_rate_limiter: RateLimiter::new(),
        image_issue_rate_limiter: RateLimiter::new(),
        captcha_memory: CaptchaMemoryStore::new(),
        captcha_signing_key: Arc::new(vec![]),
    };
    let router = create_router(state);
    for (method, path, body) in [
        ("GET", "/api/v1/admin/mail/status", ""),
        (
            "POST",
            "/api/v1/admin/mail/test",
            r#"{"to":"test@example.test"}"#,
        ),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"adminpass123"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let login: Value = serde_json::from_slice(&bytes).unwrap();
    let bearer = format!("Bearer {}", login["access_token"].as_str().unwrap());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/admin/mail/status")
                .header("authorization", &bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let status: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        status,
        json!({"pending":0,"failed":0,"last_success_at":null,"last_error":null})
    );
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/mail/test")
                .header("authorization", &bearer)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"to":"test@example.test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(server.messages.lock().await.len(), 1);
}

#[tokio::test]
async fn approval_between_pending_check_and_writeback_cannot_strand_reply() {
    let server = smtp(false).await;
    let mut config = config(server.port);
    config.mail.notify_admin = false;
    let db = setup(&config).await;
    let parent = create(&db, &config, json!({"mail":"parent@example.test"})).await;
    let reply = create(&db, &config, json!({"pid":parent.id})).await;
    let job = mail_queue::claim(&db, Utc::now().naive_utc())
        .await
        .unwrap()
        .unwrap();
    for status in ["pending", "approved"] {
        comment_service::update_status(
            &db,
            &config.comment,
            &reply.id,
            CommentStatusUpdate {
                status: status.into(),
            },
        )
        .await
        .unwrap();
    }
    // 工作者先前已观察到 pending，写回前管理员通过了审核。
    assert!(
        mail_queue::finish(
            &db,
            &job,
            Outcome::Waiting,
            Utc::now().naive_utc() - Duration::seconds(3)
        )
        .await
        .unwrap()
    );
    drain(&db, &config).await;
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.status, "sent");
    assert_eq!(job.attempts, 1);
    assert_eq!(server.messages.lock().await.len(), 1);
}

#[tokio::test]
async fn wrong_smtp_password_is_redacted_and_uses_failure_budget() {
    let server = smtp(true).await;
    let mut config = config(server.port);
    config.mail.username = "smtp-user".into();
    config.mail.password = "secret-password".into();
    let db = setup(&config).await;
    create(&db, &config, json!({})).await;
    assert!(
        mail_worker::process_once(&db, &config.jwt.secret)
            .await
            .unwrap()
    );
    let job = mail_jobs::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(job.attempts, 1);
    assert_eq!(job.last_error.as_deref(), Some("smtp_rejected"));
    assert!(server.messages.lock().await.is_empty());
}

#[tokio::test]
async fn worker_rechecks_parent_existence_and_reply_switch_before_sending() {
    let server = smtp(false).await;
    let mut config = config(server.port);
    config.mail.notify_admin = false;
    let db = setup(&config).await;
    let first = create(&db, &config, json!({"mail":"parent@example.test"})).await;
    create(&db, &config, json!({"pid":first.id})).await;
    // 模拟另一个数据库管理者移除了父记录，工作者仍需主动重检。
    comments::Entity::delete_by_id(first.id)
        .exec(&db)
        .await
        .unwrap();
    drain(&db, &config).await;
    let second = create(&db, &config, json!({"mail":"parent@example.test"})).await;
    create(&db, &config, json!({"pid":second.id})).await;
    patch(&db, &config, json!({"notify_reply":false})).await;
    drain(&db, &config).await;
    assert_eq!(
        mail_jobs::Entity::find()
            .filter(mail_jobs::Column::Status.eq("cancelled"))
            .count(&db)
            .await
            .unwrap(),
        2
    );
    assert!(server.messages.lock().await.is_empty());
}
