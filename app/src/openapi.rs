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
        handlers::auth::login,
        handlers::auth::logout,
        handlers::comment::list_comments,
        handlers::comment::submit_comment,
        handlers::admin_comment::list_admin_comments,
        handlers::admin_comment::update_comment_status,
        handlers::admin_comment::delete_comment,
        handlers::admin_comment::import_valine,
        handlers::admin_comment::get_stats,
        handlers::admin_comment::get_admin_config,
    ),
    components(schemas(
        dto::HealthResponse,
        dto::MessageResponse,
        dto::ErrorResponse,
        dto::LoginRequest,
        dto::LoginResponse,
        dto::CommentCreateRequest,
        dto::CommentPublicResponse,
        dto::CommentListResponse,
        dto::AdminCommentResponse,
        dto::AdminCommentListResponse,
        dto::CommentStatusUpdate,
        dto::UrlCount,
        dto::CommentStatsResponse,
        dto::CommentConfigResponse,
        dto::AdminConfigResponse,
        dto::ValineImportItem,
        dto::ValineImportRequest,
        dto::ValineImportReport,
    )),
    modifiers(&SecurityAddon),
    tags(
        (name = "health", description = "健康检查"),
        (name = "auth", description = "登录 / 登出"),
        (name = "comments", description = "公共评论接口（匿名）"),
        (name = "comments-admin", description = "评论管理接口（需认证）"),
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
