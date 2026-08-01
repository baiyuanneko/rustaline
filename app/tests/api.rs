//! 端到端集成测试：内存 SQLite + 完整 router（tower oneshot，不起端口）。
//! 黑名单用例会拉起本机 redis-server 临时实例；二进制不存在时自动跳过该用例

use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use app::config::{AppConfig, DatabaseConfig, JwtConfig, LogConfig, RedisConfig, ServerConfig};
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
    })
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
