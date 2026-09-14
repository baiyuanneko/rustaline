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
    // 白名单到此为止：qq_avatar / ip / ua 等一律由服务端推导或采集，
    // 客户端即使提交也会被 serde 忽略（M-4 加固）
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

/// 一楼（root 评论 + 回复预览）：root 字段平铺自 CommentPublicResponse
#[derive(Debug, Serialize, ToSchema)]
pub struct CommentThreadRoot {
    #[serde(flatten)]
    #[schema(inline)]
    pub comment: CommentPublicResponse,
    /// 该楼 approved 回复总数（含未加载的）
    pub reply_count: u64,
    /// 回复预览：本楼最早若干条（见 PREVIEW 上限），按 inserted_at 升序
    pub replies: Vec<CommentPublicResponse>,
}

/// 公共列表契约（M-2）：按楼分页。count 是该 url 可见评论总数（含全部回复），
/// root_total 是分页依据；replies 不全时前端调 /comments/replies 展开
#[derive(Debug, Serialize, ToSchema)]
pub struct CommentThreadResponse {
    pub count: u64,
    pub root_total: u64,
    pub page: u64,
    pub page_size: u64,
    pub roots: Vec<CommentThreadRoot>,
}

/// 楼内回复全量/增量拉取
#[derive(Debug, Serialize, ToSchema)]
pub struct CommentRepliesResponse {
    pub total: u64,
    pub results: Vec<CommentPublicResponse>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct CommentListQuery {
    pub url: String,
    #[serde(default)]
    pub page: Option<u64>,
    #[serde(default)]
    pub page_size: Option<u64>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct CommentRepliesQuery {
    pub url: String,
    /// 楼 root 评论 id
    pub rid: String,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(default)]
    pub limit: Option<u64>,
}

/// 父评论摘要：管理列表里把「回复谁」直观展示出来，避免只给一串 pid
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminCommentParent {
    pub id: String,
    pub nick: String,
    pub comment: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminCommentResponse {
    pub id: String,
    pub comment: String,
    pub nick: String,
    pub mail: Option<String>,
    pub link: Option<String>,
    pub qq_avatar: Option<String>,
    /// 服务端推导好的头像 URL（qq_avatar 优先，否则邮箱的真 MD5 → gravatar 镜像），
    /// 客户端直接使用，不要在前端重复对邮箱做哈希
    pub avatar: Option<String>,
    pub url: String,
    pub pid: Option<String>,
    pub rid: Option<String>,
    /// 父评论摘要（pid 指向的评论存在时返回；仅列表接口填充）
    pub parent: Option<AdminCommentParent>,
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
    /// 起始日期（YYYY-MM-DD，UTC 零点起算），仅返回 inserted_at >= 该日期的评论
    pub from: Option<String>,
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
    /// 邮箱头像镜像 CDN（空字符串 = 已禁用邮箱头像层）
    pub avatar_cdn: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminConfigResponse {
    pub comment: CommentConfigResponse,
    pub version: String,
    /// 演示首页是否启用（false 时 / 重定向到 /admin/）
    pub introduction_index: bool,
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
