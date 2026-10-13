use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MailTestRequest {
    pub to: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MailStatusResponse {
    pub pending: u64,
    pub failed: u64,
    pub last_success_at: Option<NaiveDateTime>,
    pub last_error: Option<String>,
}
