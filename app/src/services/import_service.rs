//! Valine/LeanCloud 数据导入：兼容两种日期形态与包装格式，按 objectId 幂等。

use std::collections::HashSet;

use chrono::Utc;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};
use serde_json::Value;

use crate::dto::{ValineImportItem, ValineImportReport};
use crate::entities::comments;
use crate::error::AppError;

use super::comment_service::{
    MAX_ID_LEN, MAX_IP_LEN, MAX_LINK_LEN, MAX_MAIL_LEN, MAX_NICK_LEN, MAX_QQ_AVATAR_LEN,
    MAX_UA_LEN, MAX_URL_LEN, normalize_url,
};

const MAX_BATCH: usize = 1000;
const MAX_ERRORS: usize = 20;

pub async fn import_valine(
    db: &DatabaseConnection,
    body: Value,
) -> Result<ValineImportReport, AppError> {
    let items = extract_items(body)?;

    if items.len() > MAX_BATCH {
        return Err(AppError::BadRequest(format!(
            "batch exceeds {MAX_BATCH} items"
        )));
    }

    let all_ids: Vec<String> = items.iter().filter_map(|i| i.object_id.clone()).collect();
    let existing: HashSet<String> = if all_ids.is_empty() {
        HashSet::new()
    } else {
        comments::Entity::find()
            .filter(comments::Column::Id.is_in(all_ids))
            .all(db)
            .await?
            .into_iter()
            .map(|m| m.id)
            .collect()
    };

    let now = Utc::now().naive_utc();
    let mut models: Vec<comments::ActiveModel> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut skipped_duplicates = 0u64;
    let mut skipped_invalid = 0u64;
    let mut errors: Vec<String> = Vec::new();
    let total = items.len() as u64;

    for item in items {
        let Some(id) = item.object_id.as_ref().filter(|s| !s.is_empty()) else {
            skipped_invalid += 1;
            push_error(&mut errors, "missing objectId");
            continue;
        };
        let Some(comment) = item.comment.as_ref().filter(|s| !s.is_empty()) else {
            skipped_invalid += 1;
            push_error(&mut errors, "missing comment");
            continue;
        };
        let Some(url) = item.url.as_ref().filter(|s| !s.is_empty()) else {
            skipped_invalid += 1;
            push_error(&mut errors, "missing url");
            continue;
        };

        // 各字段长度与列宽对齐（M-3）：任一超长，整条判 invalid 并记录明细
        let too_long = [
            ("objectId", Some(id.as_str()), MAX_ID_LEN),
            ("url", Some(url.as_str()), MAX_URL_LEN),
            ("nick", item.nick.as_deref(), MAX_NICK_LEN),
            ("mail", item.mail.as_deref(), MAX_MAIL_LEN),
            ("link", item.link.as_deref(), MAX_LINK_LEN),
            ("qq_avatar", item.qq_avatar.as_deref(), MAX_QQ_AVATAR_LEN),
            ("ua", item.ua.as_deref(), MAX_UA_LEN),
            ("ip", item.ip.as_deref(), MAX_IP_LEN),
        ]
        .into_iter()
        .find_map(|(field, value, max)| match value {
            Some(v) if v.chars().count() > max => {
                Some(format!("{id}: {field} exceeds {max} characters"))
            }
            _ => None,
        });
        if let Some(reason) = too_long {
            skipped_invalid += 1;
            push_error(&mut errors, &reason);
            continue;
        }

        if existing.contains(id) || !seen.insert(id.clone()) {
            skipped_duplicates += 1;
            continue;
        }

        let inserted_at = item.inserted_at.unwrap_or(now);
        let created_at = item.created_at.unwrap_or(now);
        let updated_at = item.updated_at.unwrap_or(now);

        models.push(comments::ActiveModel {
            id: sea_orm::ActiveValue::Set(id.clone()),
            comment: sea_orm::ActiveValue::Set(comment.clone()),
            nick: sea_orm::ActiveValue::Set(item.nick.unwrap_or_else(|| "Anonymous".to_owned())),
            mail: sea_orm::ActiveValue::Set(item.mail),
            link: sea_orm::ActiveValue::Set(item.link),
            qq_avatar: sea_orm::ActiveValue::Set(item.qq_avatar),
            url: sea_orm::ActiveValue::Set(normalize_url(url)),
            pid: sea_orm::ActiveValue::Set(item.pid),
            rid: sea_orm::ActiveValue::Set(item.rid),
            ip: sea_orm::ActiveValue::Set(item.ip),
            ua: sea_orm::ActiveValue::Set(item.ua),
            is_notified: sea_orm::ActiveValue::Set(item.is_notified.unwrap_or(false)),
            status: sea_orm::ActiveValue::Set("approved".to_owned()),
            inserted_at: sea_orm::ActiveValue::Set(inserted_at),
            created_at: sea_orm::ActiveValue::Set(created_at),
            updated_at: sea_orm::ActiveValue::Set(updated_at),
        });
    }

    let imported = models.len() as u64;
    if !models.is_empty() {
        let txn = db.begin().await?;
        comments::Entity::insert_many(models).exec(&txn).await?;
        txn.commit().await?;
    }

    Ok(ValineImportReport {
        total,
        imported,
        skipped_duplicates,
        skipped_invalid,
        errors,
    })
}

fn extract_items(body: Value) -> Result<Vec<ValineImportItem>, AppError> {
    match body {
        Value::Array(_) => serde_json::from_value(body)
            .map_err(|e| AppError::BadRequest(format!("invalid items: {e}"))),
        Value::Object(ref map) => {
            if let Some(results) = map.get("results") {
                serde_json::from_value(results.clone())
                    .map_err(|e| AppError::BadRequest(format!("invalid items: {e}")))
            } else {
                Err(AppError::BadRequest(
                    "expected { \"results\": [...] } or [...]".into(),
                ))
            }
        }
        _ => Err(AppError::BadRequest("expected JSON array or object".into())),
    }
}

fn push_error(errors: &mut Vec<String>, reason: &str) {
    if errors.len() < MAX_ERRORS {
        errors.push(reason.to_owned());
    }
}
