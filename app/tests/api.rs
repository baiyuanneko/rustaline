//! 端到端集成测试：内存 SQLite + 完整 router（tower oneshot，不起端口）。
//! 黑名单用例会拉起本机 redis-server 临时实例；二进制不存在时自动跳过该用例

use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use app::config::{
    AppConfig, CommentConfig, DatabaseConfig, InitialAdminConfig, JwtConfig, LogConfig,
    RedisConfig, ServerConfig, StaticConfig,
};
use app::middleware::rate_limit::RateLimiter;
use app::routes::create_router;
use app::state::AppState;
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use migration::{Migrator, MigratorTrait};
use sea_orm::{ConnectOptions, Database};
use serde_json::{Value, json};
use tower::ServiceExt;

fn test_config(blacklist_enabled: bool) -> AppConfig {
    AppConfig {
        server: ServerConfig {
            host: "127.0.0.1".into(),
            port: 0,
        },
        database: DatabaseConfig {
            url: "sqlite::memory:".into(),
        },
        redis: RedisConfig {
            url: "redis://127.0.0.1:6379".into(),
        },
        jwt: JwtConfig {
            secret: "test-secret".into(),
            ttl_secs: 3600,
            blacklist_enabled,
        },
        log: LogConfig {
            level: "warn".into(),
        },
        static_: StaticConfig {
            dir: concat!(env!("CARGO_MANIFEST_DIR"), "/../static").into(),
            introduction_index: true,
        },
        comment: CommentConfig::default(),
        initial_admin: InitialAdminConfig {
            username: Some("admin".into()),
            password: Some("adminpass123".into()),
        },
    }
}

async fn build_app(redis_url: Option<String>, blacklist_enabled: bool) -> Router {
    let mut opt = ConnectOptions::new("sqlite::memory:");
    // 内存库必须单连接，否则连接池里的每条连接都是独立的数据库
    opt.max_connections(1);
    let db = Database::connect(opt).await.expect("connect sqlite memory");
    Migrator::up(&db, None).await.expect("run migrations");

    let mut config = test_config(blacklist_enabled);
    let redis = match redis_url {
        Some(url) => {
            config.redis.url = url.clone();
            Some(
                redis::Client::open(url)
                    .expect("redis client")
                    .get_connection_manager()
                    .await
                    .expect("redis connection manager"),
            )
        }
        None => None,
    };

    // 管理员种子入库（与生产 main.rs 同一条路径）
    app::auth::admin::seed_admin(&db, &config.initial_admin)
        .await
        .expect("seed admin");

    create_router(AppState {
        db,
        redis,
        config: Arc::new(config),
        comment_rate_limiter: RateLimiter::new(),
        login_rate_limiter: RateLimiter::new(),
    })
}

async fn build_app_with_comment(comment: CommentConfig) -> Router {
    let mut config = test_config(false);
    config.comment = comment;
    build_app_with_config(config).await
}

async fn build_app_with_config(config: AppConfig) -> Router {
    let mut opt = ConnectOptions::new("sqlite::memory:");
    opt.max_connections(1);
    let db = Database::connect(opt).await.expect("connect sqlite memory");
    Migrator::up(&db, None).await.expect("run migrations");

    app::auth::admin::seed_admin(&db, &config.initial_admin)
        .await
        .expect("seed admin");

    create_router(AppState {
        db,
        redis: None,
        config: Arc::new(config),
        comment_rate_limiter: RateLimiter::new(),
        login_rate_limiter: RateLimiter::new(),
    })
}

fn submit_comment_req(url: &str, comment: &str) -> Request<Body> {
    json_request(
        "POST",
        "/api/v1/comments",
        Some(json!({"url": url, "comment": comment})),
        None,
    )
}

fn json_request(
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    match body {
        Some(value) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(value.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn call(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

/// 用唯一管理员账号（admin / adminpass123）登录，返回 access token
async fn login(app: &Router) -> String {
    let (status, body) = call(
        app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "admin", "password": "adminpass123" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login failed");
    body["access_token"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn health_returns_200() {
    let app = build_app(None, false).await;
    let (status, body) = call(&app, json_request("GET", "/health", None, None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["db"], "up");
}

#[tokio::test]
async fn root_serves_demo_index_by_default() {
    let app = build_app(None, false).await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn root_redirects_to_admin_when_introduction_index_disabled() {
    let mut config = test_config(false);
    config.static_.introduction_index = false;
    let app = build_app_with_config(config).await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(resp.headers().get(header::LOCATION).unwrap(), "/admin/");

    // SDK / 管理面板静态资源不受重定向影响
    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/sdk/rustaline.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn auth_login_flow() {
    let app = build_app(None, false).await;

    // 未带 token 访问受保护接口 -> 401
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/comments", None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // 错误 token -> 401
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/comments", None, Some("not-a-token")),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // 错误密码 -> 401
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "admin", "password": "wrong-password" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], 401);

    // 错误用户名 -> 401
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "nobody", "password": "adminpass123" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], 401);

    // 正确凭据登录 -> 200，token 可访问管理接口
    let token = login(&app).await;
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// 拉起临时 redis-server；二进制不存在时返回 None（测试将跳过）
struct RedisGuard {
    child: Child,
    url: String,
}

impl Drop for RedisGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_redis() -> Option<RedisGuard> {
    // 先占用一个临时端口再释放，拿到空闲端口号
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .ok()?
        .local_addr()
        .ok()?
        .port();

    let child = Command::new("redis-server")
        .args([
            "--port",
            &port.to_string(),
            "--bind",
            "127.0.0.1",
            "--save",
            "",
            "--appendonly",
            "no",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // 等待端口就绪
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Some(RedisGuard {
                child,
                url: format!("redis://127.0.0.1:{port}"),
            });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

#[tokio::test]
async fn logout_revokes_token_via_blacklist() {
    let Some(redis) = spawn_redis() else {
        eprintln!("redis-server binary not found, skipping blacklist test");
        return;
    };

    let app = build_app(Some(redis.url.clone()), true).await;
    let token = login(&app).await;

    // logout 前 token 可用
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // logout -> 200
    let (status, _) = call(
        &app,
        json_request("POST", "/api/v1/auth/logout", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 同一 token 再次访问 -> 401（已进黑名单）
    let (status, body) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], 401);
}

#[tokio::test]
async fn openapi_json_is_served() {
    let app = build_app(None, false).await;
    let (status, body) = call(
        &app,
        json_request("GET", "/api-doc/openapi.json", None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["info"]["title"], "bynrust26 API");
    assert!(body["paths"]["/api/v1/auth/login"].is_object());
}

#[tokio::test]
async fn static_files_are_served() {
    let app = build_app(None, false).await;

    async fn get_header(app: &Router, uri: &str, name: header::HeaderName) -> (StatusCode, String) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let content_type = response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        (response.status(), content_type)
    }

    // 目录请求默认返回 index.html（静态目录兜底挂载在根路径）
    let (status, ct) = get_header(&app, "/", header::CONTENT_TYPE).await;
    assert_eq!(status, StatusCode::OK);
    assert!(ct.contains("text/html"), "unexpected content-type: {ct}");

    let (status, ct) = get_header(&app, "/app.js", header::CONTENT_TYPE).await;
    assert_eq!(status, StatusCode::OK);
    assert!(ct.contains("javascript"), "unexpected content-type: {ct}");

    // 管理面板目录请求返回其 index.html
    let (status, ct) = get_header(&app, "/admin/", header::CONTENT_TYPE).await;
    assert_eq!(status, StatusCode::OK);
    assert!(ct.contains("text/html"), "unexpected content-type: {ct}");

    let (status, _) = get_header(&app, "/not-exist.txt", header::CONTENT_TYPE).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // 旧的 /static 前缀已下线
    let (status, _) = get_header(&app, "/static/index.html", header::CONTENT_TYPE).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn comment_submit_and_validation() {
    let app = build_app(None, false).await;

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/p1", "comment": "Hello!", "nick": "tester", "mail": "t@e.com"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["comment"], "Hello!");
    assert_eq!(body["nick"], "tester");
    assert_eq!(body["url"], "/p1");
    assert!(
        body["avatar"]
            .as_str()
            .unwrap()
            .contains("gravatar.loli.net")
    );
    assert!(body["ip"].is_null());
    assert!(body["mail"].is_null());
    assert!(body["ua"].is_null());
    assert!(body["status"].is_null());

    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "", "comment": "has comment"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/p1", "comment": ""})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn avatar_cdn_override_and_disable() {
    // 自定义 CDN（不带尾斜杠，验证归一化）：邮箱头像拼到自定义镜像
    let app = build_app_with_comment(CommentConfig {
        avatar_cdn: "https://avatar.example.com".into(),
        ..CommentConfig::default()
    })
    .await;
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/cdn", "comment": "hi", "mail": "t@e.com"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // 精确匹配：既验证自定义 CDN，又验证尾斜杠归一化（不出现双斜杠）与真 MD5
    assert_eq!(
        body["avatar"].as_str().unwrap(),
        "https://avatar.example.com/b3aae4075a6e6ae93455d49d77d544a8"
    );

    // 置空：禁用邮箱头像层，avatar 为 null
    let app = build_app_with_comment(CommentConfig {
        avatar_cdn: String::new(),
        ..CommentConfig::default()
    })
    .await;
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/cdn", "comment": "hi", "mail": "t@e.com"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["avatar"].is_null());
}

#[tokio::test]
async fn comment_list_isolation_and_status() {
    let app = build_app(None, false).await;

    call(&app, submit_comment_req("/iso-a", "A1")).await;
    call(&app, submit_comment_req("/iso-b", "B1")).await;

    let (status, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fiso-a", None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);
    assert_eq!(body["roots"][0]["comment"], "A1");

    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fiso-b", None, None),
    )
    .await;
    assert_eq!(body["count"], 1);
    assert_eq!(body["roots"][0]["comment"], "B1");

    let app = build_app_with_comment(CommentConfig {
        moderation: true,
        ..CommentConfig::default()
    })
    .await;
    call(&app, submit_comment_req("/pending-test", "hidden")).await;
    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fpending-test", None, None),
    )
    .await;
    assert_eq!(body["count"], 0, "pending should not be publicly visible");
}

#[tokio::test]
async fn comment_reply_tree() {
    let app = build_app(None, false).await;

    let (_, body) = call(&app, submit_comment_req("/tree", "root")).await;
    let root_id = body["id"].as_str().unwrap().to_owned();

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/tree", "comment": "reply", "pid": root_id})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["pid"], root_id);
    assert_eq!(body["rid"], root_id, "rid should inherit root id");

    let (_, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/tree", "comment": "reply2", "pid": root_id})),
            None,
        ),
    )
    .await;
    let child_id = body["id"].as_str().unwrap().to_owned();

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/tree", "comment": "grandchild", "pid": child_id})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["pid"], child_id);
    assert_eq!(body["rid"], root_id, "rid should inherit parent's rid");

    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/tree", "comment": "bad", "pid": "nonexistent"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn comment_moderation_flow() {
    let app = build_app_with_comment(CommentConfig {
        moderation: true,
        ..CommentConfig::default()
    })
    .await;

    call(&app, submit_comment_req("/mod", "pending comment")).await;
    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fmod", None, None),
    )
    .await;
    assert_eq!(body["count"], 0);

    let token = login(&app).await;
    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?url=%2Fmod",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(body["total"], 1);
    assert_eq!(body["items"][0]["status"], "pending");
    let id = body["items"][0]["id"].as_str().unwrap();

    let (status, body) = call(
        &app,
        json_request(
            "PATCH",
            &format!("/api/v1/admin/comments/{id}"),
            Some(json!({"status": "approved"})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "approved");

    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fmod", None, None),
    )
    .await;
    assert_eq!(body["count"], 1);
}

#[tokio::test]
async fn admin_comment_management() {
    let app = build_app(None, false).await;

    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/comments", None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let token = login(&app).await;

    call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/mgmt", "comment": "first", "nick": "alice", "mail": "a@x.com"})),
            None,
        ),
    )
    .await;
    call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/mgmt", "comment": "second", "nick": "bob"})),
            None,
        ),
    )
    .await;

    let (status, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?url=%2Fmgmt",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 2);
    assert!(
        body["items"][0]["ip"].is_string(),
        "admin list should include ip"
    );
    assert_eq!(body["page"], 1);
    assert_eq!(body["page_size"], 20);

    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?keyword=alice",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(body["total"], 1);

    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?page=1&page_size=1",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
    assert_eq!(body["total"], 2);

    let (status, _) = call(
        &app,
        json_request(
            "PATCH",
            "/api/v1/admin/comments/nonexistent-id-123",
            Some(json!({"status": "spam"})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn admin_list_filter_from_date() {
    let app = build_app(None, false).await;
    let token = login(&app).await;

    // 造一条评论，取其 inserted_at 的日期部分作为 from（与服务端同为 UTC 口径）
    let (_, created) = call(&app, submit_comment_req("/from", "hello")).await;
    let inserted = created["inserted_at"].as_str().unwrap().to_owned();
    let day = &inserted[..10];

    // from = 当天 -> 能查到
    let (status, body) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/admin/comments?from={day}"),
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 1);

    // from = 未来日期 -> 查不到
    let (status, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?from=2999-01-01",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 0);

    // 非法日期 -> 400
    let (status, _) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?from=not-a-date",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn admin_delete_reparents_children() {
    let app = build_app(None, false).await;
    let token = login(&app).await;

    let (_, body) = call(&app, submit_comment_req("/del", "root")).await;
    let root_id = body["id"].as_str().unwrap().to_owned();

    call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/del", "comment": "child", "pid": root_id})),
            None,
        ),
    )
    .await;

    let (status, _) = call(
        &app,
        json_request(
            "DELETE",
            &format!("/api/v1/admin/comments/{root_id}"),
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?url=%2Fdel",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(body["total"], 1, "child should survive");
    assert!(
        body["items"][0]["pid"].is_null(),
        "child pid should be nullified"
    );
    assert!(
        body["items"][0]["rid"].is_null(),
        "child rid should be nullified"
    );

    let (status, _) = call(
        &app,
        json_request(
            "DELETE",
            "/api/v1/admin/comments/nonexistent-del",
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn admin_stats_and_config() {
    let app = build_app(None, false).await;

    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/comments/stats", None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let token = login(&app).await;

    call(&app, submit_comment_req("/s1", "c1")).await;
    call(&app, submit_comment_req("/s1", "c2")).await;
    call(&app, submit_comment_req("/s2", "c3")).await;

    let (status, body) = call(
        &app,
        json_request("GET", "/api/v1/admin/comments/stats", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 3);
    assert_eq!(body["approved"], 3);
    assert_eq!(body["pending"], 0);
    assert_eq!(body["spam"], 0);
    assert_eq!(body["today_new"], 3);
    let urls = body["urls"].as_array().unwrap();
    assert_eq!(urls.len(), 2);
    assert_eq!(urls[0]["count"], 2, "most commented url should be first");

    let (status, body) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["comment"]["moderation"], false);
    assert_eq!(body["comment"]["max_length"], 10000);
    assert_eq!(body["comment"]["rate_limit_per_minute"], 5);
    assert_eq!(body["comment"]["default_nick"], "Anonymous");
    assert!(body["version"].is_string());
}

#[tokio::test]
async fn import_valine_data() {
    let app = build_app(None, false).await;
    let token = login(&app).await;

    let wrapped = json!({
        "results": [{
            "objectId": "obj1",
            "comment": "imported via wrapped",
            "nick": "wally",
            "mail": "w@e.com",
            "url": "/imp",
            "insertedAt": {"__type": "Date", "iso": "2020-01-01T00:00:00.000Z"},
            "createdAt": "2020-01-01T00:00:00.000Z"
        }]
    });
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/comments/import/valine",
            Some(wrapped),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["imported"], 1);
    assert_eq!(body["skipped_duplicates"], 0);

    let bare_array = json!([{
        "objectId": "obj2",
        "comment": "imported via array",
        "url": "/imp",
        "insertedAt": "2021-06-15T10:30:00Z"
    }]);
    let (_, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/comments/import/valine",
            Some(bare_array),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(body["imported"], 1);

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/comments/import/valine",
            Some(json!({"results": [{"objectId": "obj1", "comment": "dup", "url": "/imp"}]})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["imported"], 0);
    assert_eq!(body["skipped_duplicates"], 1);

    let (_, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/comments/import/valine",
            Some(json!({"results": [{"objectId": "bad1"}, {"comment": "no-id", "url": "/x"}]})),
            Some(&token),
        ),
    )
    .await;
    assert!(body["skipped_invalid"].as_u64().unwrap() >= 2);

    let mut big: Vec<Value> = Vec::new();
    for i in 0..1001 {
        big.push(json!({"objectId": format!("big{i}"), "comment": "c", "url": "/big"}));
    }
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/comments/import/valine",
            Some(json!({"results": big})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn comment_rate_limit() {
    let app = build_app_with_comment(CommentConfig {
        rate_limit_per_minute: 2,
        ..CommentConfig::default()
    })
    .await;

    let (s1, _) = call(&app, submit_comment_req("/rl", "ok1")).await;
    assert_eq!(s1, StatusCode::CREATED);
    let (s2, _) = call(&app, submit_comment_req("/rl", "ok2")).await;
    assert_eq!(s2, StatusCode::CREATED);

    let (s3, body) = call(&app, submit_comment_req("/rl", "over")).await;
    assert_eq!(s3, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["code"], 429);
}

#[tokio::test]
async fn comment_honeypot() {
    let app = build_app(None, false).await;

    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/hp-test", "comment": "bot spam", "hp": "filled"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "honeypot should return 201");

    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fhp-test", None, None),
    )
    .await;
    assert_eq!(body["count"], 0, "honeypot comment must not be persisted");
}

#[tokio::test]
async fn admin_password_hash_roundtrip() {
    let hash = app::auth::admin::hash_password("rootpass123").expect("hash");
    assert!(hash.starts_with("$argon2"), "must store argon2 PHC string");
    assert!(
        app::auth::admin::verify_password("rootpass123", &hash).expect("verify ok"),
        "correct password must pass"
    );
    assert!(
        !app::auth::admin::verify_password("otherpass999", &hash).expect("verify bad"),
        "wrong password must fail"
    );
}

#[tokio::test]
async fn admin_seed_only_applies_when_table_empty() {
    use app::auth::admin::{seed_admin, verify_login};

    let mut opt = ConnectOptions::new("sqlite::memory:");
    opt.max_connections(1);
    let db = Database::connect(opt).await.expect("connect sqlite memory");
    Migrator::up(&db, None).await.expect("run migrations");

    // 空表 + 缺 env -> 报错（启动失败语义）
    assert!(
        seed_admin(&db, &InitialAdminConfig::default())
            .await
            .is_err()
    );
    // 空表 + 空密码 -> 报错
    let empty_pw = InitialAdminConfig {
        username: Some("admin".into()),
        password: Some(String::new()),
    };
    assert!(seed_admin(&db, &empty_pw).await.is_err());

    // 首次种子生效
    let cfg_a = InitialAdminConfig {
        username: Some("admin".into()),
        password: Some("adminpass123".into()),
    };
    assert!(seed_admin(&db, &cfg_a).await.expect("first seed"));

    // 已有记录后 env 被完全忽略：第二次种子不写库
    let cfg_b = InitialAdminConfig {
        username: Some("root".into()),
        password: Some("rootpass999".into()),
    };
    assert!(!seed_admin(&db, &cfg_b).await.expect("second seed"));

    // 以库为准：env B 的凭据无效，库中的凭据有效
    assert!(
        verify_login(&db, "admin", "adminpass123")
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        verify_login(&db, "root", "rootpass999")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn admin_change_password_flow() {
    let app = build_app(None, false).await;
    let token = login(&app).await;

    // 错误当前密码 -> 400
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/account/password",
            Some(json!({"current_password": "wrong", "new_password": "newpass456"})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // 新密码过短 -> 400
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/account/password",
            Some(json!({"current_password": "adminpass123", "new_password": "short"})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // 正确改密 -> 200
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/account/password",
            Some(json!({"current_password": "adminpass123", "new_password": "newpass456"})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // token_version 自增：改密前的 token（含改密所用的那个）立即失效
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, Some(&token)),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "old token must be revoked"
    );

    // 旧密码登录 -> 401；新密码登录 -> 200 且新 token 可用
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "admin", "password": "adminpass123" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "old password must fail");

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "admin", "password": "newpass456" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let new_token = body["access_token"].as_str().unwrap().to_owned();
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/admin/config", None, Some(&new_token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "new token must work");
}

#[tokio::test]
async fn comment_submit_ignores_client_supplied_avatar() {
    let app = build_app(None, false).await;

    // M-4：客户端提交的 qq_avatar 必须被忽略，avatar 由服务端按 mail 推导
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({
                "url": "/wl", "comment": "hi", "mail": "t@e.com",
                "qq_avatar": "http://evil.example/x.png"
            })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        body["avatar"].as_str().unwrap(),
        "https://gravatar.loli.net/avatar/b3aae4075a6e6ae93455d49d77d544a8",
        "avatar must be derived from mail, not client-supplied qq_avatar"
    );

    // 管理端确认 qq_avatar 未被持久化
    let token = login(&app).await;
    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?url=%2Fwl",
            None,
            Some(&token),
        ),
    )
    .await;
    assert!(
        body["items"][0]["qq_avatar"].is_null(),
        "client-supplied qq_avatar must not be stored"
    );
}

#[tokio::test]
async fn comment_rid_is_server_derived() {
    let app = build_app(None, false).await;

    // 顶层评论即使带了 rid 也必须被丢弃
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/rid", "comment": "root", "rid": "forged-rid"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["rid"].is_null(), "top-level rid must be discarded");
    let root_id = body["id"].as_str().unwrap().to_owned();

    // 回复时显式 rid 与父评论推导值不一致 -> 400
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/rid", "comment": "bad", "pid": root_id, "rid": "other-thread"})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // 显式 rid 与推导值一致则放行
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/rid", "comment": "good", "pid": root_id, "rid": root_id})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["rid"], root_id);
}

#[tokio::test]
async fn comment_field_length_limits() {
    let app = build_app(None, false).await;

    // url 256 字符 -> 400；255 字符（上限）-> 201
    let (status, _) = call(
        &app,
        submit_comment_req(&format!("/{}", "u".repeat(255)), "x"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "url over 255 must fail");
    let (status, _) = call(
        &app,
        submit_comment_req(&format!("/{}", "u".repeat(254)), "x"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "url at 255 must pass");

    // nick 65 -> 400；64 -> 201
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/len", "comment": "x", "nick": "n".repeat(65)})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "nick over 64 must fail");

    // mail 129 -> 400（格式合法但超长）
    let long_mail = format!("{}@e.com", "m".repeat(123));
    assert!(long_mail.len() == 129);
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/len", "comment": "x", "mail": long_mail})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "mail over 128 must fail");

    // link 256 -> 400
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/comments",
            Some(json!({"url": "/len", "comment": "x", "link": format!("https://{}", "l".repeat(248))})),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "link over 255 must fail");
}

#[tokio::test]
async fn comment_ua_is_truncated_to_column_width() {
    let app = build_app(None, false).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/comments")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::USER_AGENT, "x".repeat(600))
        .body(Body::from(
            json!({"url": "/ua", "comment": "hi"}).to_string(),
        ))
        .unwrap();
    let (status, _) = call(&app, req).await;
    assert_eq!(status, StatusCode::CREATED);

    let token = login(&app).await;
    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/admin/comments?url=%2Fua",
            None,
            Some(&token),
        ),
    )
    .await;
    let ua = body["items"][0]["ua"].as_str().unwrap();
    assert_eq!(ua.chars().count(), 512, "ua must be truncated to 512 chars");
}

#[tokio::test]
async fn import_rejects_oversized_fields() {
    let app = build_app(None, false).await;
    let token = login(&app).await;

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/admin/comments/import/valine",
            Some(json!({"results": [
                {"objectId": "ok1", "comment": "fine", "url": "/imp-len"},
                {"objectId": "big-nick", "comment": "x", "url": "/imp-len", "nick": "n".repeat(65)},
                {"objectId": "big-ua", "comment": "x", "url": "/imp-len", "ua": "u".repeat(513)}
            ]})),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["imported"], 1);
    assert_eq!(body["skipped_invalid"], 2);
    let errors = body["errors"].as_array().unwrap();
    assert!(
        errors
            .iter()
            .any(|e| e.as_str().unwrap().contains("big-nick: nick")),
        "error detail should name id and field: {errors:?}"
    );
    assert!(
        errors
            .iter()
            .any(|e| e.as_str().unwrap().contains("big-ua: ua")),
        "error detail should name id and field: {errors:?}"
    );
}

#[tokio::test]
async fn login_rate_limit() {
    let app = build_app(None, false).await;

    // M-1：前 5 次（含错误凭据）都能到达认证逻辑返回 401；第 6 次被限流 429
    for i in 0..5 {
        let (status, _) = call(
            &app,
            json_request(
                "POST",
                "/api/v1/auth/login",
                Some(json!({ "username": "admin", "password": format!("wrong-{i}") })),
                None,
            ),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "attempt {i} should reach auth logic"
        );
    }

    // 第 6 次即使凭据正确也被限流（计数发生在认证之前）
    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "admin", "password": "adminpass123" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["code"], 429);
}

#[tokio::test]
async fn comment_threads_pagination() {
    // 放宽提交限流（本用例连发 14 条，默认 5/分钟会拦截）
    let app = build_app_with_comment(CommentConfig {
        rate_limit_per_minute: 1000,
        ..CommentConfig::default()
    })
    .await;

    // 12 个 root；第 1 个 root 下挂 2 条回复
    let mut first_root = String::new();
    for i in 0..12 {
        let (_, body) = call(&app, submit_comment_req("/page", &format!("root-{i}"))).await;
        if i == 0 {
            first_root = body["id"].as_str().unwrap().to_owned();
        }
    }
    for j in 0..2 {
        call(
            &app,
            json_request(
                "POST",
                "/api/v1/comments",
                Some(json!({"url": "/page", "comment": format!("r{j}"), "pid": first_root})),
                None,
            ),
        )
        .await;
    }

    // 第 1 页：默认 10 楼，root 倒序（最新在前）
    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fpage", None, None),
    )
    .await;
    assert_eq!(body["count"], 14, "count 含全部回复");
    assert_eq!(body["root_total"], 12);
    assert_eq!(body["page"], 1);
    assert_eq!(body["page_size"], 10, "默认 page_size = 10");
    assert_eq!(body["roots"].as_array().unwrap().len(), 10);
    assert_eq!(body["roots"][0]["comment"], "root-11", "root 应倒序");
    assert_eq!(body["roots"][0]["reply_count"], 0);

    // 第 2 页：剩 2 楼，first_root 在此，带 reply_count 与预览
    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fpage&page=2", None, None),
    )
    .await;
    let roots = body["roots"].as_array().unwrap();
    assert_eq!(roots.len(), 2);
    let thread = roots
        .iter()
        .find(|t| t["id"] == first_root)
        .expect("first_root should be on page 2");
    assert_eq!(thread["reply_count"], 2);
    let replies = thread["replies"].as_array().unwrap();
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0]["comment"], "r0", "预览按时间升序");

    // page_size 传 100 被 clamp 到 20
    let (_, body) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/comments?url=%2Fpage&page_size=100",
            None,
            None,
        ),
    )
    .await;
    assert_eq!(body["page_size"], 20);
    assert_eq!(body["roots"].as_array().unwrap().len(), 12);
}

#[tokio::test]
async fn comment_thread_preview_and_expand() {
    let app = build_app_with_comment(CommentConfig {
        rate_limit_per_minute: 1000,
        ..CommentConfig::default()
    })
    .await;

    let (_, body) = call(&app, submit_comment_req("/exp", "root")).await;
    let root_id = body["id"].as_str().unwrap().to_owned();

    // 7 条回复，混合平挂 root 与链式嵌套
    let mut prev = root_id.clone();
    for i in 0..7 {
        let pid = if i % 2 == 0 {
            root_id.clone()
        } else {
            prev.clone()
        };
        let (_, body) = call(
            &app,
            json_request(
                "POST",
                "/api/v1/comments",
                Some(json!({"url": "/exp", "comment": format!("r{i}"), "pid": pid})),
                None,
            ),
        )
        .await;
        prev = body["id"].as_str().unwrap().to_owned();
    }

    // 楼预览：reply_count=7，replies 仅最早 5 条
    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fexp", None, None),
    )
    .await;
    let thread = &body["roots"][0];
    assert_eq!(thread["reply_count"], 7);
    let preview = thread["replies"].as_array().unwrap();
    assert_eq!(preview.len(), 5, "预览上限 5 条");
    assert_eq!(preview[0]["comment"], "r0");
    assert_eq!(preview[4]["comment"], "r4");

    // 展开：offset=5 拿剩余 2 条
    let (_, body) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/comments/replies?url=%2Fexp&rid={root_id}&offset=5"),
            None,
            None,
        ),
    )
    .await;
    assert_eq!(body["total"], 7);
    let results = body["results"].as_array().unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["comment"], "r5");
    let a_reply_id = results[0]["id"].as_str().unwrap().to_owned();

    // limit 传 999 被 clamp 到 50（总量 7，全返回）
    let (_, body) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/comments/replies?url=%2Fexp&rid={root_id}&limit=999"),
            None,
            None,
        ),
    )
    .await;
    assert_eq!(body["results"].as_array().unwrap().len(), 7);

    // rid 校验：不存在 / 跨 url / 非顶层评论 -> 400
    let (status, _) = call(
        &app,
        json_request(
            "GET",
            "/api/v1/comments/replies?url=%2Fexp&rid=nope",
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/comments/replies?url=%2Fother&rid={root_id}"),
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/comments/replies?url=%2Fexp&rid={a_reply_id}"),
            None,
            None,
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "rid 指向非顶层评论必须 400"
    );
}
