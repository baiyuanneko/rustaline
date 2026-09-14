//! 评论领域逻辑：URL 归一化、头像推导、树关系校验、审核状态管理、stats 聚合。

use chrono::{NaiveDate, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, DatabaseConnection, EntityTrait,
    ExprTrait, IntoSimpleExpr, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};
use uuid::Uuid;

use crate::config::CommentConfig;
use crate::dto::{
    AdminCommentListResponse, AdminCommentParent, AdminCommentResponse, AdminConfigResponse,
    CommentConfigResponse, CommentCreateRequest, CommentPublicResponse, CommentRepliesResponse,
    CommentStatsResponse, CommentStatusUpdate, CommentThreadResponse, CommentThreadRoot, UrlCount,
};
use crate::entities::comments;
use crate::error::AppError;

pub fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.len() > 1 {
        trimmed.trim_end_matches('/').to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// 字段长度上限（按字符数计），与建表迁移的 varchar 长度对齐：
/// migration/src/m20260802_000001_create_comment.rs，改动需两边同步（M-3）
pub(crate) const MAX_ID_LEN: usize = 64;
pub(crate) const MAX_URL_LEN: usize = 255;
pub(crate) const MAX_NICK_LEN: usize = 64;
pub(crate) const MAX_MAIL_LEN: usize = 128;
pub(crate) const MAX_LINK_LEN: usize = 255;
pub(crate) const MAX_QQ_AVATAR_LEN: usize = 255;
pub(crate) const MAX_IP_LEN: usize = 64;
pub(crate) const MAX_UA_LEN: usize = 512;

/// stats URL 热度排行返回条数上限（前端仪表盘只展示前 10，评论管理 URL 筛选共用此列表）
const URL_RANK_LIMIT: u64 = 30;

/// 可选字段长度校验：非空且超长时返回 400
fn check_len(field: &str, value: &Option<String>, max: usize) -> Result<(), AppError> {
    if let Some(v) = value.as_ref().filter(|s| !s.is_empty())
        && v.chars().count() > max
    {
        return Err(AppError::BadRequest(format!(
            "{field} exceeds {max} characters"
        )));
    }
    Ok(())
}

/// 头像推导：qq_avatar 原样优先；其次邮箱 trim+lowercase 取 MD5 拼 gravatar 镜像 CDN。
/// cdn 置空时完全禁用邮箱头像层（仅剩 QQ 头像 / 前端首字母兜底）
pub fn derive_avatar(
    qq_avatar: &Option<String>,
    mail: &Option<String>,
    cdn: &str,
) -> Option<String> {
    if let Some(qq) = qq_avatar.as_ref().filter(|s| !s.is_empty()) {
        return Some(qq.clone());
    }
    let cdn = cdn.trim();
    if cdn.is_empty() {
        return None;
    }
    if let Some(mail) = mail.as_ref().filter(|s| !s.is_empty()) {
        let normalized = mail.trim().to_lowercase();
        let hash = format!("{:x}", md5::compute(normalized.as_bytes()));
        return Some(format!("{}/{hash}", cdn.trim_end_matches('/')));
    }
    None
}

/// 公共列表分页参数（M-2）：root 每页默认 10、上限 20；楼内回复预览 5 条；
/// 楼内展开每次最多 50 条
const ROOT_PAGE_DEFAULT: u64 = 10;
const ROOT_PAGE_MAX: u64 = 20;
const REPLY_PREVIEW_LIMIT: u64 = 5;
const REPLIES_LIMIT_MAX: u64 = 50;

/// 按楼分页的公共列表（M-2）：root 评论（pid IS NULL）按 inserted_at 倒序分页，
/// 每楼附带回复总数与最早 REPLY_PREVIEW_LIMIT 条预览。
/// count 为该 url 全部 approved 评论数（root + 回复），供前端「N 条评论」文案。
pub async fn list_threads(
    db: &DatabaseConnection,
    config: &CommentConfig,
    url: &str,
    page: u64,
    page_size: u64,
) -> Result<CommentThreadResponse, AppError> {
    let normalized = normalize_url(url);
    // 注：不能写 page.max(1)，会与 sea_orm ExprTrait::max 冲突
    let page = if page == 0 { 1 } else { page };
    let page_size = if page_size == 0 {
        ROOT_PAGE_DEFAULT
    } else {
        page_size.clamp(1, ROOT_PAGE_MAX)
    };

    let approved_in_url = || {
        comments::Entity::find()
            .filter(comments::Column::Url.eq(&normalized))
            .filter(comments::Column::Status.eq("approved"))
    };

    let count = approved_in_url().count(db).await?;
    let root_total = approved_in_url()
        .filter(comments::Column::Pid.is_null())
        .count(db)
        .await?;

    let roots = approved_in_url()
        .filter(comments::Column::Pid.is_null())
        .order_by_desc(comments::Column::InsertedAt)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all(db)
        .await?;

    // 一次 GROUP BY 拿本页全部楼的回复数（走 idx_comments_rid）
    let root_ids: Vec<String> = roots.iter().map(|r| r.id.clone()).collect();
    let mut reply_counts: std::collections::HashMap<String, u64> = Default::default();
    if !root_ids.is_empty() {
        let count_expr = Expr::col(comments::Column::Rid).into_simple_expr().count();
        let rows: Vec<ReplyCountRow> = comments::Entity::find()
            .select_only()
            .column(comments::Column::Rid)
            .expr_as(count_expr, "count")
            .filter(comments::Column::Rid.is_in(root_ids))
            .filter(comments::Column::Status.eq("approved"))
            .group_by(comments::Column::Rid)
            .into_model::<ReplyCountRow>()
            .all(db)
            .await?;
        for r in rows {
            if let Some(rid) = r.rid {
                reply_counts.insert(rid, r.count as u64);
            }
        }
    }

    // 每楼拉预览：逐楼 LIMIT 5 的 N+1 是有意的——root 每页 ≤20 楼，
    // 总查询数可控，比一次性拉出全部回复（单楼可能上百条）更省内存与带宽
    let mut threads = Vec::with_capacity(roots.len());
    for root in roots {
        let replies = comments::Entity::find()
            .filter(comments::Column::Rid.eq(&root.id))
            .filter(comments::Column::Status.eq("approved"))
            .order_by_asc(comments::Column::InsertedAt)
            .limit(REPLY_PREVIEW_LIMIT)
            .all(db)
            .await?;
        threads.push(CommentThreadRoot {
            reply_count: reply_counts.get(&root.id).copied().unwrap_or(0),
            replies: replies
                .into_iter()
                .map(|m| public_dto_from_model(m, &config.avatar_cdn))
                .collect(),
            comment: public_dto_from_model(root, &config.avatar_cdn),
        });
    }

    Ok(CommentThreadResponse {
        count,
        root_total,
        page,
        page_size,
        roots: threads,
    })
}

/// 楼内回复展开（M-2）：rid 必须指向同 url 的真实顶层评论，按时间升序 offset/limit。
pub async fn list_replies(
    db: &DatabaseConnection,
    config: &CommentConfig,
    url: &str,
    rid: &str,
    offset: u64,
    limit: u64,
) -> Result<CommentRepliesResponse, AppError> {
    let normalized = normalize_url(url);
    let limit = if limit == 0 {
        REPLIES_LIMIT_MAX
    } else {
        limit.clamp(1, REPLIES_LIMIT_MAX)
    };

    let root = comments::Entity::find_by_id(rid)
        .filter(comments::Column::Url.eq(&normalized))
        .filter(comments::Column::Status.eq("approved"))
        .one(db)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest("rid refers to a non-existent comment in this url".into())
        })?;
    if root.pid.is_some() {
        return Err(AppError::BadRequest(
            "rid must refer to a top-level comment".into(),
        ));
    }

    let base = || {
        comments::Entity::find()
            .filter(comments::Column::Rid.eq(rid))
            .filter(comments::Column::Status.eq("approved"))
    };
    let total = base().count(db).await?;
    let rows = base()
        .order_by_asc(comments::Column::InsertedAt)
        .offset(offset)
        .limit(limit)
        .all(db)
        .await?;

    Ok(CommentRepliesResponse {
        total,
        results: rows
            .into_iter()
            .map(|m| public_dto_from_model(m, &config.avatar_cdn))
            .collect(),
    })
}

pub async fn create_comment(
    db: &DatabaseConnection,
    config: &CommentConfig,
    payload: CommentCreateRequest,
    ip: String,
    ua: Option<String>,
) -> Result<CommentPublicResponse, AppError> {
    let normalized_url = normalize_url(&payload.url);

    if let Some(hp) = payload.hp.as_ref()
        && !hp.is_empty()
    {
        return Ok(fake_response(&payload, &normalized_url, config));
    }

    if normalized_url.is_empty() {
        return Err(AppError::BadRequest("url must not be empty".into()));
    }
    if normalized_url.chars().count() > MAX_URL_LEN {
        return Err(AppError::BadRequest(format!(
            "url exceeds {MAX_URL_LEN} characters"
        )));
    }

    let trimmed_comment = payload.comment.trim();
    if trimmed_comment.is_empty() {
        return Err(AppError::BadRequest("comment must not be empty".into()));
    }
    if trimmed_comment.chars().count() > config.max_length {
        return Err(AppError::BadRequest(format!(
            "comment exceeds max length {max}",
            max = config.max_length
        )));
    }
    check_len("mail", &payload.mail, MAX_MAIL_LEN)?;
    if let Some(ref mail) = payload.mail
        && !mail.is_empty()
        && !is_valid_email(mail)
    {
        return Err(AppError::BadRequest("invalid email format".into()));
    }
    check_len("nick", &payload.nick, MAX_NICK_LEN)?;
    check_len("link", &payload.link, MAX_LINK_LEN)?;

    let (pid_val, rid_val) = resolve_tree(db, &normalized_url, &payload).await?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().naive_utc();
    let nick = payload
        .nick
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| config.default_nick.clone());
    let status = if config.moderation {
        "pending"
    } else {
        "approved"
    };

    let active = comments::ActiveModel {
        id: Set(id.clone()),
        comment: Set(trimmed_comment.to_owned()),
        nick: Set(nick),
        mail: Set(payload.mail.filter(|s| !s.is_empty())),
        link: Set(payload.link.filter(|s| !s.is_empty())),
        // 公共接口不接受客户端提交的 qq_avatar（M-4 白名单）；仅导入通道可写入
        qq_avatar: Set(None),
        url: Set(normalized_url.clone()),
        pid: Set(pid_val),
        rid: Set(rid_val),
        ip: Set(Some(ip)),
        ua: Set(ua),
        is_notified: Set(false),
        status: Set(status.to_owned()),
        inserted_at: Set(now),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let model = active.insert(db).await?;
    Ok(public_dto_from_model(model, &config.avatar_cdn))
}

/// list_admin 的过滤条件打包（status/url/keyword/from），避免参数膨胀
#[derive(Debug, Default, Clone, Copy)]
pub struct AdminListFilter<'a> {
    pub status: Option<&'a str>,
    pub url: Option<&'a str>,
    pub keyword: Option<&'a str>,
    /// 起始日期（YYYY-MM-DD，UTC 零点起算），非法格式返回 400
    pub from: Option<&'a str>,
}

pub async fn list_admin(
    db: &DatabaseConnection,
    config: &CommentConfig,
    filter: AdminListFilter<'_>,
    page: u64,
    page_size: u64,
) -> Result<AdminCommentListResponse, AppError> {
    let mut query = comments::Entity::find();
    if let Some(s) = filter.status.filter(|s| !s.is_empty()) {
        query = query.filter(comments::Column::Status.eq(s));
    }
    if let Some(u) = filter.url.filter(|s| !s.is_empty()) {
        query = query.filter(comments::Column::Url.eq(normalize_url(u)));
    }
    if let Some(kw) = filter.keyword.filter(|s| !s.is_empty()) {
        let pat = format!("%{kw}%");
        query = query.filter(
            Condition::any()
                .add(comments::Column::Nick.like(&pat))
                .add(comments::Column::Comment.like(&pat))
                .add(comments::Column::Mail.like(&pat)),
        );
    }
    // from：YYYY-MM-DD（UTC 零点起算），与 stats 的 today_new 同口径
    if let Some(f) = filter.from.filter(|s| !s.is_empty()) {
        let date = NaiveDate::parse_from_str(f, "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("from must be a YYYY-MM-DD date".into()))?;
        query = query.filter(
            comments::Column::InsertedAt.gte(date.and_hms_opt(0, 0, 0).unwrap_or_default()),
        );
    }

    let total = query.clone().count(db).await?;
    let rows = query
        .order_by_desc(comments::Column::InsertedAt)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all(db)
        .await?;

    // 批量取本页所有 pid 指向的父评论（一次 IN 查询），供前端展示「回复 @谁：摘要」
    let pids: Vec<String> = rows
        .iter()
        .filter_map(|r| r.pid.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let parents = if pids.is_empty() {
        Vec::new()
    } else {
        comments::Entity::find()
            .filter(comments::Column::Id.is_in(pids))
            .all(db)
            .await?
    };
    let parent_map: std::collections::HashMap<String, AdminCommentParent> = parents
        .into_iter()
        .map(|p| {
            (
                p.id.clone(),
                AdminCommentParent {
                    id: p.id,
                    nick: p.nick,
                    comment: p.comment,
                },
            )
        })
        .collect();

    Ok(AdminCommentListResponse {
        items: rows
            .into_iter()
            .map(|m| {
                let parent = m.pid.as_ref().and_then(|pid| parent_map.get(pid).cloned());
                admin_dto_from_model(m, parent, &config.avatar_cdn)
            })
            .collect(),
        total,
        page,
        page_size,
    })
}

pub async fn update_status(
    db: &DatabaseConnection,
    config: &CommentConfig,
    id: &str,
    payload: CommentStatusUpdate,
) -> Result<AdminCommentResponse, AppError> {
    let model = comments::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("comment {id} not found")))?;

    let status = payload.status.trim().to_lowercase();
    if !matches!(status.as_str(), "approved" | "pending" | "spam") {
        return Err(AppError::BadRequest(
            "status must be approved, pending, or spam".into(),
        ));
    }

    let mut active: comments::ActiveModel = model.into();
    active.status = Set(status);
    active.updated_at = Set(Utc::now().naive_utc());
    let updated = active.update(db).await?;
    Ok(admin_dto_from_model(updated, None, &config.avatar_cdn))
}

pub async fn delete_comment(db: &DatabaseConnection, id: &str) -> Result<(), AppError> {
    let model = comments::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("comment {id} not found")))?;

    comments::Entity::update_many()
        .col_expr(comments::Column::Pid, Expr::value(None::<String>))
        .col_expr(comments::Column::Rid, Expr::value(None::<String>))
        .filter(comments::Column::Pid.eq(&model.id))
        .exec(db)
        .await?;

    comments::Entity::delete_by_id(model.id).exec(db).await?;
    Ok(())
}

pub async fn get_stats(db: &DatabaseConnection) -> Result<CommentStatsResponse, AppError> {
    let total = comments::Entity::find().count(db).await?;
    let approved = count_by_status(db, "approved").await?;
    let pending = count_by_status(db, "pending").await?;
    let spam = count_by_status(db, "spam").await?;

    let today_start = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap_or_default();
    let today_new = comments::Entity::find()
        .filter(comments::Column::InsertedAt.gte(today_start))
        .count(db)
        .await?;

    let count_expr = Expr::col(comments::Column::Url).into_simple_expr().count();
    let url_rows: Vec<UrlCountRow> = comments::Entity::find()
        .select_only()
        .column(comments::Column::Url)
        .expr_as(count_expr.clone(), "count")
        .group_by(comments::Column::Url)
        .order_by(count_expr, sea_orm::sea_query::Order::Desc)
        .limit(URL_RANK_LIMIT)
        .into_model::<UrlCountRow>()
        .all(db)
        .await?;
    let urls: Vec<UrlCount> = url_rows
        .into_iter()
        .map(|r| UrlCount {
            url: r.url,
            count: r.count as u64,
        })
        .collect();

    Ok(CommentStatsResponse {
        total,
        approved,
        pending,
        spam,
        today_new,
        urls,
    })
}

pub fn get_admin_config(config: &crate::config::AppConfig) -> AdminConfigResponse {
    AdminConfigResponse {
        comment: CommentConfigResponse {
            moderation: config.comment.moderation,
            max_length: config.comment.max_length,
            rate_limit_per_minute: config.comment.rate_limit_per_minute,
            default_nick: config.comment.default_nick.clone(),
            avatar_cdn: config.comment.avatar_cdn.clone(),
        },
        version: env!("CARGO_PKG_VERSION").to_owned(),
        introduction_index: config.static_.introduction_index,
    }
}

async fn count_by_status(db: &DatabaseConnection, status: &str) -> Result<u64, AppError> {
    Ok(comments::Entity::find()
        .filter(comments::Column::Status.eq(status))
        .count(db)
        .await?)
}

async fn resolve_tree(
    db: &DatabaseConnection,
    normalized_url: &str,
    payload: &CommentCreateRequest,
) -> Result<(Option<String>, Option<String>), AppError> {
    let pid = payload.pid.as_ref().filter(|s| !s.is_empty());
    let rid = payload.rid.as_ref().filter(|s| !s.is_empty());

    // 顶层评论：rid 无意义，客户端即使传了也强制丢弃（M-4）
    let Some(pid) = pid else {
        return Ok((None, None));
    };

    let parent = comments::Entity::find_by_id(pid)
        .filter(comments::Column::Url.eq(normalized_url))
        .filter(comments::Column::Status.eq("approved"))
        .one(db)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest("pid refers to a non-existent comment in this url".into())
        })?;

    // rid 由父评论推导；客户端显式给的 rid 若与推导值不一致视为伪造，直接拒绝（M-4）
    let derived = parent.rid.clone().unwrap_or_else(|| parent.id.clone());
    if let Some(r) = rid
        && *r != derived
    {
        return Err(AppError::BadRequest(
            "rid does not match the parent comment's thread".into(),
        ));
    }
    Ok((Some(pid.clone()), Some(derived)))
}

fn fake_response(
    payload: &CommentCreateRequest,
    normalized_url: &str,
    config: &CommentConfig,
) -> CommentPublicResponse {
    CommentPublicResponse {
        id: Uuid::new_v4().to_string(),
        comment: payload.comment.clone(),
        nick: payload
            .nick
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| config.default_nick.clone()),
        link: payload.link.clone(),
        // 蜜罐假响应同样不信任客户端头像字段
        avatar: derive_avatar(&None, &payload.mail, &config.avatar_cdn),
        url: normalized_url.to_owned(),
        pid: payload.pid.clone(),
        rid: payload.rid.clone(),
        inserted_at: Utc::now().naive_utc(),
    }
}

fn public_dto_from_model(m: comments::Model, cdn: &str) -> CommentPublicResponse {
    CommentPublicResponse {
        avatar: derive_avatar(&m.qq_avatar, &m.mail, cdn),
        id: m.id,
        comment: m.comment,
        nick: m.nick,
        link: m.link,
        url: m.url,
        pid: m.pid,
        rid: m.rid,
        inserted_at: m.inserted_at,
    }
}

fn admin_dto_from_model(
    m: comments::Model,
    parent: Option<AdminCommentParent>,
    cdn: &str,
) -> AdminCommentResponse {
    // 在字段被 move 前先推导头像（qq_avatar 优先，其次邮箱 MD5）
    let avatar = derive_avatar(&m.qq_avatar, &m.mail, cdn);
    AdminCommentResponse {
        id: m.id,
        comment: m.comment,
        nick: m.nick,
        mail: m.mail,
        link: m.link,
        qq_avatar: m.qq_avatar,
        avatar,
        url: m.url,
        pid: m.pid,
        rid: m.rid,
        parent,
        ip: m.ip,
        ua: m.ua,
        is_notified: m.is_notified,
        status: m.status,
        inserted_at: m.inserted_at,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn is_valid_email(email: &str) -> bool {
    let at = match email.find('@') {
        Some(i) => i,
        None => return false,
    };
    let domain = &email[at + 1..];
    !domain.is_empty() && domain.contains('.') && at > 0
}

#[derive(sea_orm::FromQueryResult)]
struct UrlCountRow {
    url: String,
    count: i64,
}

#[derive(sea_orm::FromQueryResult)]
struct ReplyCountRow {
    rid: Option<String>,
    count: i64,
}
