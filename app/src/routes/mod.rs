use axum::Router;
use axum::http::{HeaderValue, header};
use axum::middleware::from_fn_with_state;
use axum::response::Redirect;
use axum::routing::{get, patch, post};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeader;
use tower_http::trace::TraceLayer;

use crate::middleware::rate_limit::{
    image_issue_rate_limit_middleware, login_rate_limit_middleware,
    pow_issue_rate_limit_middleware, rate_limit_middleware,
};
use crate::state::AppState;
use crate::{handlers, openapi};

pub fn create_router(state: AppState) -> Router {
    let router = Router::new()
        .route("/health", get(handlers::health::health))
        .nest("/api/v1", api_v1(state.clone()));

    // Swagger UI 开关（APP_ENABLE_SWAGGER_UI）：关闭时不挂载，路径落到静态兜底 404
    let router = if state.config.swagger.enabled {
        router.merge(openapi::swagger_ui())
    } else {
        router
    };

    // 演示页禁用（static.introduction_index = false）时，给 / 显式挂临时重定向到管理面板，
    // 优先于 ServeDir 兜底；用 307 而非 301，开关回改后浏览器不会缓存死重定向
    let router = if state.config.static_.introduction_index {
        router
    } else {
        router.route("/", get(|| async { Redirect::temporary("/admin/") }))
    };

    router
        // 静态文件兜底：显式路由（/health、/api/**、/swagger-ui、/api-doc）优先，
        // 其余路径落到 static/ 目录（/ -> index.html，/admin/ -> 管理面板）。
        // no-cache 强制浏览器每次向服务器再验证（未变则 304），避免启发式缓存
        // 导致 ES Modules 新旧版本混载（如 settings.js 新 / api.js 旧）。
        .fallback_service(SetResponseHeader::overriding(
            ServeDir::new(&state.config.static_.dir),
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
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
        .merge(
            Router::new()
                .route("/auth/login", post(handlers::auth::login))
                .layer(from_fn_with_state(
                    state.clone(),
                    login_rate_limit_middleware,
                )),
        )
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/comments", get(handlers::comment::list_comments))
        .route("/comments/replies", get(handlers::comment::list_replies))
        .route(
            "/captcha/config",
            get(handlers::captcha::get_captcha_config),
        )
        .merge(
            Router::new()
                .route("/captcha/pow", get(handlers::captcha::get_pow_challenge))
                .layer(from_fn_with_state(
                    state.clone(),
                    pow_issue_rate_limit_middleware,
                )),
        )
        .merge(
            Router::new()
                .route("/captcha/image", get(handlers::captcha::get_image_captcha))
                .layer(from_fn_with_state(
                    state.clone(),
                    image_issue_rate_limit_middleware,
                )),
        )
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
        .route("/account/password", post(handlers::auth::change_password))
}
