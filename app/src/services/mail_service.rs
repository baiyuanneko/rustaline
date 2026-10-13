use super::{
    mail_queue, mail_templates, mail_transport,
    settings_service::{RuntimeSettings, SettingsSnapshot},
};
use crate::{
    dto::{MailStatusResponse, MailTestRequest},
    error::AppError,
    state::AppState,
};

pub use mail_queue::enqueue_new_comment;

pub fn paused(settings: &SettingsSnapshot) -> bool {
    !settings.mail.enabled
        || settings.password_needs_reset
        || (!settings.mail.username.is_empty() && settings.mail.password.is_empty())
}

pub async fn send_test(
    settings: &RuntimeSettings,
    payload: MailTestRequest,
) -> Result<(), AppError> {
    let settings = &settings.0;
    if !settings.mail.enabled {
        return Err(AppError::BadRequest(
            "SMTP is disabled; enable and save it first".into(),
        ));
    }
    if settings.password_needs_reset {
        return Err(AppError::BadRequest(
            "SMTP password must be configured again".into(),
        ));
    }
    if !settings.mail.username.is_empty() && settings.mail.password.is_empty() {
        return Err(AppError::BadRequest(
            "SMTP password is required for the configured username".into(),
        ));
    }
    if !mail_queue::valid_address(&payload.to) {
        return Err(AppError::BadRequest(
            "invalid recipient email address".into(),
        ));
    }
    let (subject, body) = mail_templates::test(&settings.mail);
    let message = mail_transport::message(
        &settings.mail,
        &payload.to,
        &uuid::Uuid::new_v4().to_string(),
        subject,
        body,
    )
    .map_err(|error| AppError::BadRequest(error.into()))?;
    mail_transport::send(&settings.mail, message)
        .await
        .map_err(|error| AppError::BadRequest(format!("SMTP test failed: {error}")))
}

pub async fn status(state: &AppState) -> Result<MailStatusResponse, AppError> {
    mail_queue::status(&state.db).await
}
