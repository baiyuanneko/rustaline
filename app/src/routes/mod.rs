use axum::Router;
use axum::middleware::from_fn_with_state;
use axum::routing::{get, patch, post};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::middleware::rate_limit::rate_limit_middleware;
use crate::state::AppState;
use crate::{handlers, openapi};

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(handlers::health::health))
        .nest("/api/v1", api_v1(state.clone()))
        .merge(openapi::swagger_ui())
        .nest_service("/static", ServeDir::new(&state.config.static_.dir))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

fn api_v1(state: AppState) -> Router<AppState> {
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
        .route("/comments", get(handlers::comment::list_comments))
        .merge(
            Router::new()
                .route("/comments", post(handlers::comment::submit_comment))
                .layer(from_fn_with_state(state, rate_limit_middleware)),
        )
        .nest("/admin", admin_routes())
}

fn admin_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/comments",
            get(handlers::admin_comment::list_admin_comments),
        )
        .route("/comments/stats", get(handlers::admin_comment::get_stats))
        .route(
            "/comments/import/valine",
            post(handlers::admin_comment::import_valine),
        )
        .route(
            "/comments/{id}",
            patch(handlers::admin_comment::update_comment_status)
                .delete(handlers::admin_comment::delete_comment),
        )
        .route("/config", get(handlers::admin_comment::get_admin_config))
}
