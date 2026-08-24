//! 评论领域逻辑：URL 归一化、头像推导、树关系校验、审核状态管理、stats 聚合。

use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, DatabaseConnection, EntityTrait,
    ExprTrait, IntoSimpleExpr, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};
use uuid::Uuid;

use crate::config::CommentConfig;
use crate::dto::{
    AdminCommentListResponse, AdminCommentParent, AdminCommentResponse, AdminConfigResponse,
    CommentConfigResponse, CommentCreateRequest, CommentPublicResponse, CommentStatsResponse,
    CommentStatusUpdate, UrlCount,
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

pub fn derive_avatar(qq_avatar: &Option<String>, mail: &Option<String>) -> Option<String> {
    if let Some(qq) = qq_avatar.as_ref().filter(|s| !s.is_empty()) {
        return Some(qq.clone());
    }
    if let Some(mail) = mail.as_ref().filter(|s| !s.is_empty()) {
        let normalized = mail.trim().to_lowercase();
        let hash = format!("{:x}", md5::compute(normalized.as_bytes()));
        return Some(format!("https://cravatar.cn/avatar/{hash}"));
    }
    None
}

pub async fn list_by_url(
    db: &DatabaseConnection,
    url: &str,
) -> Result<Vec<CommentPublicResponse>, AppError> {
    let normalized = normalize_url(url);
    let rows = comments::Entity::find()
        .filter(comments::Column::Url.eq(&normalized))
        .filter(comments::Column::Status.eq("approved"))
        .order_by_asc(comments::Column::InsertedAt)
        .all(db)
        .await?;
    Ok(rows.into_iter().map(public_dto_from_model).collect())
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
    if let Some(ref mail) = payload.mail
        && !mail.is_empty()
        && !is_valid_email(mail)
    {
        return Err(AppError::BadRequest("invalid email format".into()));
    }
    if let Some(ref nick) = payload.nick
        && nick.chars().count() > 64
    {
        return Err(AppError::BadRequest("nick exceeds 64 characters".into()));
    }

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
        qq_avatar: Set(payload.qq_avatar.filter(|s| !s.is_empty())),
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
    Ok(public_dto_from_model(model))
}

pub async fn list_admin(
    db: &DatabaseConnection,
    status: Option<&str>,
    url: Option<&str>,
    keyword: Option<&str>,
    page: u64,
    page_size: u64,
) -> Result<AdminCommentListResponse, AppError> {
    let mut query = comments::Entity::find();
    if let Some(s) = status.filter(|s| !s.is_empty()) {
        query = query.filter(comments::Column::Status.eq(s));
    }
    if let Some(u) = url.filter(|s| !s.is_empty()) {
        query = query.filter(comments::Column::Url.eq(normalize_url(u)));
    }
    if let Some(kw) = keyword.filter(|s| !s.is_empty()) {
        let pat = format!("%{kw}%");
        query = query.filter(
            Condition::any()
                .add(comments::Column::Nick.like(&pat))
                .add(comments::Column::Comment.like(&pat))
                .add(comments::Column::Mail.like(&pat)),
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
                admin_dto_from_model(m, parent)
            })
            .collect(),
        total,
        page,
        page_size,
    })
}

pub async fn update_status(
    db: &DatabaseConnection,
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
    Ok(admin_dto_from_model(updated, None))
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
        .limit(100)
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
        },
        version: env!("CARGO_PKG_VERSION").to_owned(),
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

    let Some(pid) = pid else {
        return Ok((None, rid.cloned()));
    };

    let parent = comments::Entity::find_by_id(pid)
        .filter(comments::Column::Url.eq(normalized_url))
        .filter(comments::Column::Status.eq("approved"))
        .one(db)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest("pid refers to a non-existent comment in this url".into())
        })?;

    let resolved_rid = match rid {
        Some(r) => r.clone(),
        None => parent.rid.clone().unwrap_or_else(|| parent.id.clone()),
    };
    Ok((Some(pid.clone()), Some(resolved_rid)))
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
        avatar: derive_avatar(&payload.qq_avatar, &payload.mail),
        url: normalized_url.to_owned(),
        pid: payload.pid.clone(),
        rid: payload.rid.clone(),
        inserted_at: Utc::now().naive_utc(),
    }
}

fn public_dto_from_model(m: comments::Model) -> CommentPublicResponse {
    CommentPublicResponse {
        avatar: derive_avatar(&m.qq_avatar, &m.mail),
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
) -> AdminCommentResponse {
    AdminCommentResponse {
        id: m.id,
        comment: m.comment,
        nick: m.nick,
        mail: m.mail,
        link: m.link,
        qq_avatar: m.qq_avatar,
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
