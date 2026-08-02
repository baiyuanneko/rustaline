use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Deserialize, ToSchema)]
pub struct CommentCreateRequest {
    pub url: String,
    pub comment: String,
    pub nick: Option<String>,
    pub mail: Option<String>,
    pub link: Option<String>,
    pub pid: Option<String>,
    pub rid: Option<String>,
    pub qq_avatar: Option<String>,
    #[serde(default)]
    pub hp: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CommentPublicResponse {
    pub id: String,
    pub comment: String,
    pub nick: String,
    pub link: Option<String>,
    pub avatar: Option<String>,
    pub url: String,
    pub pid: Option<String>,
    pub rid: Option<String>,
    pub inserted_at: NaiveDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CommentListResponse {
    pub count: u64,
    pub results: Vec<CommentPublicResponse>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct CommentListQuery {
    pub url: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminCommentResponse {
    pub id: String,
    pub comment: String,
    pub nick: String,
    pub mail: Option<String>,
    pub link: Option<String>,
    pub qq_avatar: Option<String>,
    pub url: String,
    pub pid: Option<String>,
    pub rid: Option<String>,
    pub ip: Option<String>,
    pub ua: Option<String>,
    pub is_notified: bool,
    pub status: String,
    pub inserted_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminCommentListResponse {
    pub items: Vec<AdminCommentResponse>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct AdminCommentQuery {
    pub status: Option<String>,
    pub url: Option<String>,
    pub keyword: Option<String>,
    #[serde(default)]
    pub page: Option<u64>,
    #[serde(default)]
    pub page_size: Option<u64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CommentStatusUpdate {
    pub status: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UrlCount {
    pub url: String,
    pub count: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CommentStatsResponse {
    pub total: u64,
    pub approved: u64,
    pub pending: u64,
    pub spam: u64,
    pub today_new: u64,
    pub urls: Vec<UrlCount>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CommentConfigResponse {
    pub moderation: bool,
    pub max_length: usize,
    pub rate_limit_per_minute: u32,
    pub default_nick: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminConfigResponse {
    pub comment: CommentConfigResponse,
    pub version: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ValineImportItem {
    #[serde(alias = "objectId", default)]
    pub object_id: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub nick: Option<String>,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(rename = "QQAvatar", default)]
    pub qq_avatar: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(deserialize_with = "deserialize_nonempty_opt", default)]
    pub pid: Option<String>,
    #[serde(deserialize_with = "deserialize_nonempty_opt", default)]
    pub rid: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub ua: Option<String>,
    #[serde(rename = "isNotified", default)]
    pub is_notified: Option<bool>,
    #[serde(
        alias = "insertedAt",
        deserialize_with = "deserialize_valine_date",
        default
    )]
    pub inserted_at: Option<NaiveDateTime>,
    #[serde(
        alias = "createdAt",
        deserialize_with = "deserialize_valine_date",
        default
    )]
    pub created_at: Option<NaiveDateTime>,
    #[serde(
        alias = "updatedAt",
        deserialize_with = "deserialize_valine_date",
        default
    )]
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ValineImportRequest {
    #[serde(default)]
    pub results: Vec<ValineImportItem>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ValineImportReport {
    pub total: u64,
    pub imported: u64,
    pub skipped_duplicates: u64,
    pub skipped_invalid: u64,
    pub errors: Vec<String>,
}

fn deserialize_nonempty_opt<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(d)?;
    Ok(s.filter(|v| !v.is_empty()))
}

fn deserialize_valine_date<'de, D>(d: D) -> Result<Option<NaiveDateTime>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error as _;
    let v: Option<serde_json::Value> = Option::deserialize(d)?;
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => parse_iso(&s).map(Some).map_err(D::Error::custom),
        Some(serde_json::Value::Object(map)) => match map.get("iso").and_then(|v| v.as_str()) {
            Some(iso) => parse_iso(iso).map(Some).map_err(D::Error::custom),
            None => Ok(None),
        },
        _ => Ok(None),
    }
}

fn parse_iso(s: &str) -> Result<NaiveDateTime, String> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(dt.naive_utc());
    }
    for fmt in &["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Ok(dt);
        }
        if *fmt == "%Y-%m-%d"
            && let Ok(d) = chrono::NaiveDate::parse_from_str(s, fmt)
        {
            return Ok(d.and_hms_opt(0, 0, 0).unwrap_or_default());
        }
    }
    Err(format!("unparseable date: {s}"))
}
