use crate::{
    auth::middleware::AuthUser,
    dto::{MailStatusResponse, MailTestRequest, MessageResponse},
    error::AppError,
    services::{mail_service, settings_service::RuntimeSettings},
    state::AppState,
};
use axum::{Json, debug_handler, extract::State};

#[utoipa::path(post, path = "/api/v1/admin/mail/test", tag = "mail-admin",
    security(("bearer_auth" = [])), request_body = MailTestRequest,
    responses((status = 200, description = "SMTP test sent", body = MessageResponse),
        (status = 400, description = "Disabled SMTP, invalid recipient or SMTP failure", body = crate::dto::ErrorResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse)))]
#[debug_handler(state = AppState)]
pub async fn send_test(
    _auth: AuthUser,
    settings: RuntimeSettings,
    Json(payload): Json<MailTestRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    mail_service::send_test(&settings, payload).await?;
    Ok(Json(MessageResponse {
        message: "Test email sent".into(),
    }))
}

#[utoipa::path(get, path = "/api/v1/admin/mail/status", tag = "mail-admin",
    security(("bearer_auth" = [])),
    responses((status = 200, description = "Persistent mail queue status", body = MailStatusResponse),
        (status = 401, description = "Unauthorized", body = crate::dto::ErrorResponse)))]
#[debug_handler]
pub async fn status(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<MailStatusResponse>, AppError> {
    Ok(Json(mail_service::status(&state).await?))
}
