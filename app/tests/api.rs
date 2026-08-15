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
        },
        comment: CommentConfig::default(),
        initial_admin: InitialAdminConfig::default(),
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

    create_router(AppState {
        db,
        redis,
        config: Arc::new(config),
        comment_rate_limiter: RateLimiter::new(),
    })
}

async fn build_app_with_comment(comment: CommentConfig) -> Router {
    let mut opt = ConnectOptions::new("sqlite::memory:");
    opt.max_connections(1);
    let db = Database::connect(opt).await.expect("connect sqlite memory");
    Migrator::up(&db, None).await.expect("run migrations");

    let mut config = test_config(false);
    config.comment = comment;

    create_router(AppState {
        db,
        redis: None,
        config: Arc::new(config),
        comment_rate_limiter: RateLimiter::new(),
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

async fn register_and_login(app: &Router, username: &str, password: &str) -> String {
    let (status, _) = call(
        app,
        json_request(
            "POST",
            "/api/v1/auth/register",
            Some(json!({ "username": username, "password": password })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "register failed");

    let (status, body) = call(
        app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": username, "password": password })),
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
async fn auth_and_crud_flow() {
    let app = build_app(None, false).await;

    // 未带 token 访问受保护接口 -> 401
    let (status, _) = call(&app, json_request("GET", "/api/v1/users", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // 错误 token -> 401
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/users", None, Some("not-a-token")),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // 重复注册 -> 409；弱密码 -> 400
    let token = register_and_login(&app, "alice", "secret123").await;
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/register",
            Some(json!({ "username": "alice", "password": "secret123" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/register",
            Some(json!({ "username": "bob", "password": "123" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // 错误密码登录 -> 401
    let (status, _) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/auth/login",
            Some(json!({ "username": "alice", "password": "wrong-password" })),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // 带 token：CRUD 全流程
    let (status, body) = call(
        &app,
        json_request("GET", "/api/v1/users", None, Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    let (status, body) = call(
        &app,
        json_request(
            "POST",
            "/api/v1/users",
            Some(json!({ "username": "carol", "password": "secret123" })),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let carol_id = body["id"].as_i64().unwrap();

    let (status, body) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/users/{carol_id}"),
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], "carol");

    let (status, body) = call(
        &app,
        json_request(
            "PUT",
            &format!("/api/v1/users/{carol_id}"),
            Some(json!({ "username": "carol2" })),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], "carol2");

    let (status, _) = call(
        &app,
        json_request(
            "DELETE",
            &format!("/api/v1/users/{carol_id}"),
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _) = call(
        &app,
        json_request(
            "GET",
            &format!("/api/v1/users/{carol_id}"),
            None,
            Some(&token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
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
    let token = register_and_login(&app, "dave", "secret123").await;

    // logout 前 token 可用
    let (status, _) = call(
        &app,
        json_request("GET", "/api/v1/users", None, Some(&token)),
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
        json_request("GET", "/api/v1/users", None, Some(&token)),
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
    assert!(body["paths"]["/api/v1/users"].is_object());
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
    assert!(body["avatar"].as_str().unwrap().contains("cravatar.cn"));
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
    assert_eq!(body["results"][0]["comment"], "A1");

    let (_, body) = call(
        &app,
        json_request("GET", "/api/v1/comments?url=%2Fiso-b", None, None),
    )
    .await;
    assert_eq!(body["count"], 1);
    assert_eq!(body["results"][0]["comment"], "B1");

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

    let token = register_and_login(&app, "mod_admin", "secret123").await;
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

    let token = register_and_login(&app, "mgr", "secret123").await;

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
async fn admin_delete_reparents_children() {
    let app = build_app(None, false).await;
    let token = register_and_login(&app, "delmgr", "secret123").await;

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

    let token = register_and_login(&app, "statmgr", "secret123").await;

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
    let token = register_and_login(&app, "impmgr", "secret123").await;

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
async fn initial_admin_seed_is_idempotent() {
    let mut opt = ConnectOptions::new("sqlite::memory:");
    opt.max_connections(1);
    let db = Database::connect(opt).await.expect("connect sqlite memory");
    Migrator::up(&db, None).await.expect("run migrations");

    let created = app::services::user_service::ensure_initial_admin(&db, "root", "rootpass123")
        .await
        .expect("seed admin");
    assert!(created, "first seed must create the account");

    // 已存在则跳过：即使传入不同密码也不覆盖原账号
    let created = app::services::user_service::ensure_initial_admin(&db, "root", "otherpass999")
        .await
        .expect("seed admin again");
    assert!(!created, "second seed must skip existing account");

    assert!(
        app::services::user_service::verify_credentials(&db, "root", "rootpass123")
            .await
            .expect("verify original password")
            .is_some(),
        "original password must still work"
    );
    assert!(
        app::services::user_service::verify_credentials(&db, "root", "otherpass999")
            .await
            .expect("verify overwritten password")
            .is_none(),
        "skipped seed must not overwrite the password"
    );
}
