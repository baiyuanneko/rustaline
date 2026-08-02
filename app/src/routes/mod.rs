//! 路由装配：/health、/api/v1/auth/{register,login,logout}、/api/v1/users CRUD、Swagger UI

use axum::Router;
use axum::routing::{get, post};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::state::AppState;
use crate::{handlers, openapi};

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(handlers::health::health))
        .nest("/api/v1", api_v1())
        .merge(openapi::swagger_ui())
        // 静态文件服务：目录请求默认返回 index.html；公开访问，不经 AuthUser
        .nest_service("/static", ServeDir::new(&state.config.static_.dir))
        .layer(TraceLayer::new_for_http())
        .layer(
            // 脚手架默认放开 CORS，生产环境按需收紧
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

fn api_v1() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/logout", post(handlers::auth::logout))
        .route(
            "/users",
            get(handlers::user::list_users).post(handlers::user::create_user),
        )
        .route(
            "/users/{id}",
            get(handlers::user::get_user)
                .put(handlers::user::update_user)
                .delete(handlers::user::delete_user),
        )
}
