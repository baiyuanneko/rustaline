//! OpenAPI 聚合：/api-doc/openapi.json + Swagger UI 挂 /swagger-ui

use utoipa::Modify;
use utoipa::openapi::security::{Http, HttpAuthScheme, SecurityScheme};
use utoipa::{OpenApi, openapi};
use utoipa_swagger_ui::SwaggerUi;

use crate::{dto, handlers};

#[derive(OpenApi)]
#[openapi(
    info(title = "bynrust26 API", version = "0.1.0", description = "bynrust26 scaffold API"),
    paths(
        handlers::health::health,
        handlers::auth::register,
        handlers::auth::login,
        handlers::auth::logout,
        handlers::user::list_users,
        handlers::user::create_user,
        handlers::user::get_user,
        handlers::user::update_user,
        handlers::user::delete_user,
    ),
    components(schemas(
        dto::HealthResponse,
        dto::MessageResponse,
        dto::ErrorResponse,
        dto::RegisterRequest,
        dto::LoginRequest,
        dto::LoginResponse,
        dto::CreateUserRequest,
        dto::UpdateUserRequest,
        dto::UserResponse,
    )),
    modifiers(&SecurityAddon),
    tags(
        (name = "health", description = "健康检查"),
        (name = "auth", description = "注册 / 登录 / 登出"),
        (name = "users", description = "用户 CRUD"),
    )
)]
pub struct ApiDoc;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
            );
        }
    }
}

/// Swagger UI，可直接 merge 进 Router；openapi.json 暴露在 /api-doc/openapi.json
pub fn swagger_ui() -> SwaggerUi {
    SwaggerUi::new("/swagger-ui").url("/api-doc/openapi.json", ApiDoc::openapi())
}
