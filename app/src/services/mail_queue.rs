//! 持久队列：事务内入队、条件领取、审核切换与终态清理。
use chrono::{Duration, NaiveDateTime, Utc};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect,
};
use uuid::Uuid;

use crate::{
    config::MailConfig,
    dto::MailStatusResponse,
    entities::{comments, mail_jobs},
    error::AppError,
};

pub fn valid_address(address: &str) -> bool {
    !address.is_empty() && address.len() <= 254 && email_address::EmailAddress::is_valid(address)
}

pub async fn enqueue_new_comment<C: ConnectionTrait>(
    db: &C,
    mail: &MailConfig,
    comment: &comments::Model,
) -> Result<(), AppError> {
    if !mail.enabled {
        return Ok(());
    }
    if mail.notify_admin && valid_address(&mail.admin_email) {
        insert(db, "admin", comment, None, &mail.admin_email, "pending").await?;
    }
    if mail.notify_reply
        && let Some(pid) = &comment.pid
        && let Some(parent) = comments::Entity::find_by_id(pid).one(db).await?
        && parent.reply_notification
        && let Some(recipient) = &parent.mail
        && valid_address(recipient)
        && !comment
            .mail
            .as_ref()
            .is_some_and(|own| own.trim().eq_ignore_ascii_case(recipient.trim()))
    {
        let status = if comment.status == "approved" {
            "pending"
        } else {
            "waiting_approval"
        };
        insert(db, "reply", comment, Some(pid.clone()), recipient, status).await?;
    }
    Ok(())
}

async fn insert<C: ConnectionTrait>(
    db: &C,
    kind: &str,
    comment: &comments::Model,
    parent_id: Option<String>,
    recipient: &str,
    status: &str,
) -> Result<(), AppError> {
    let now = Utc::now().naive_utc();
    event_insert(mail_jobs::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        event_key: Set(format!("{kind}:{}", comment.id)),
        kind: Set(kind.into()),
        comment_id: Set(comment.id.clone()),
        parent_id: Set(parent_id),
        recipient: Set(recipient.into()),
        status: Set(status.into()),
        attempts: Set(0),
        next_attempt_at: Set(now),
        lease_token: Set(None),
        lease_until: Set(None),
        last_error: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    })
    .try_insert()
    .exec(db)
    .await?;
    Ok(())
}

fn event_insert(model: mail_jobs::ActiveModel) -> sea_orm::Insert<mail_jobs::ActiveModel> {
    mail_jobs::Entity::insert(model).on_conflict(
        OnConflict::column(mail_jobs::Column::EventKey)
            .do_nothing_on([mail_jobs::Column::Id])
            .to_owned(),
    )
}

pub async fn update_comment_status<C: ConnectionTrait>(
    db: &C,
    id: &str,
    status: &str,
) -> Result<(), AppError> {
    let next = match status {
        "approved" => "pending",
        "pending" => "waiting_approval",
        _ => "cancelled",
    };
    let mut query = mail_jobs::Entity::update_many()
        .col_expr(mail_jobs::Column::Status, Expr::value(next))
        .col_expr(mail_jobs::Column::LeaseToken, Expr::value(None::<String>))
        .col_expr(
            mail_jobs::Column::LeaseUntil,
            Expr::value(None::<NaiveDateTime>),
        )
        .col_expr(
            mail_jobs::Column::UpdatedAt,
            Expr::value(Utc::now().naive_utc()),
        )
        .filter(mail_jobs::Column::CommentId.eq(id));
    if status == "approved" {
        query = query.filter(mail_jobs::Column::Status.eq("waiting_approval"));
    } else if status == "pending" {
        // 已在发送中的任务保留租约；pending→approved 不得让第二工作者重领。
        query = query
            .filter(mail_jobs::Column::Status.is_in(["pending", "waiting_approval"]))
            .filter(mail_jobs::Column::Kind.eq("reply"));
    } else {
        query = query.filter(mail_jobs::Column::Status.is_in([
            "pending",
            "waiting_approval",
            "processing",
        ]));
    }
    query.exec(db).await?;
    Ok(())
}

pub async fn cancel_for_comment<C: ConnectionTrait>(db: &C, id: &str) -> Result<(), AppError> {
    mail_jobs::Entity::update_many()
        .col_expr(mail_jobs::Column::Status, Expr::value("cancelled"))
        .col_expr(mail_jobs::Column::LeaseToken, Expr::value(None::<String>))
        .col_expr(
            mail_jobs::Column::LeaseUntil,
            Expr::value(None::<NaiveDateTime>),
        )
        .col_expr(
            mail_jobs::Column::UpdatedAt,
            Expr::value(Utc::now().naive_utc()),
        )
        .filter(
            Condition::any()
                .add(mail_jobs::Column::CommentId.eq(id))
                .add(mail_jobs::Column::ParentId.eq(id)),
        )
        .filter(mail_jobs::Column::Status.is_in(["pending", "waiting_approval", "processing"]))
        .exec(db)
        .await?;
    Ok(())
}

fn due(now: NaiveDateTime) -> Condition {
    Condition::any()
        .add(
            Condition::all()
                .add(mail_jobs::Column::Status.eq("pending"))
                .add(mail_jobs::Column::NextAttemptAt.lte(now)),
        )
        .add(
            Condition::all()
                .add(mail_jobs::Column::Status.eq("processing"))
                .add(mail_jobs::Column::LeaseUntil.lte(now)),
        )
}

/// SELECT 只找候选；领取所有权由单条带状态/时间条件的 UPDATE 决定。
pub async fn claim<C: ConnectionTrait>(
    db: &C,
    now: NaiveDateTime,
) -> Result<Option<mail_jobs::Model>, AppError> {
    let candidates = mail_jobs::Entity::find()
        .filter(due(now))
        .order_by_asc(mail_jobs::Column::NextAttemptAt)
        .limit(10)
        .all(db)
        .await?;
    for candidate in candidates {
        let token = Uuid::new_v4().to_string();
        let changed = mail_jobs::Entity::update_many()
            .col_expr(mail_jobs::Column::Status, Expr::value("processing"))
            .col_expr(mail_jobs::Column::LeaseToken, Expr::value(token.clone()))
            .col_expr(
                mail_jobs::Column::LeaseUntil,
                Expr::value(now + Duration::seconds(120)),
            )
            .col_expr(mail_jobs::Column::UpdatedAt, Expr::value(now))
            .filter(mail_jobs::Column::Id.eq(&candidate.id))
            .filter(due(now))
            .exec(db)
            .await?;
        if changed.rows_affected == 1 {
            return Ok(mail_jobs::Entity::find_by_id(candidate.id)
                .filter(mail_jobs::Column::LeaseToken.eq(token))
                .one(db)
                .await?);
        }
    }
    Ok(None)
}

/// 只允许仍持有租约的发送者写回，防过期领取者覆盖新状态。
pub async fn finish<C: ConnectionTrait>(
    db: &C,
    job: &mail_jobs::Model,
    outcome: Outcome,
    now: NaiveDateTime,
) -> Result<bool, AppError> {
    let (status, attempts, next, error) = match outcome {
        Outcome::Sent => ("sent", job.attempts + 1, now, None),
        Outcome::Cancelled => ("cancelled", job.attempts, now, None),
        Outcome::Paused => ("pending", job.attempts, now, job.last_error.clone()),
        // 审核可能在观察与写回之间通过，短暂延后重检避免批准事件丢失。
        Outcome::Waiting => (
            "pending",
            job.attempts,
            now + Duration::seconds(2),
            job.last_error.clone(),
        ),
        Outcome::Failed(error) => {
            let attempts = job.attempts + 1;
            let delays = [30, 120, 600, 1800];
            let terminal = attempts >= 5;
            let next = if terminal {
                now
            } else {
                now + Duration::seconds(delays[(attempts - 1) as usize])
            };
            (
                if terminal { "failed" } else { "pending" },
                attempts,
                next,
                Some(error.into()),
            )
        }
    };
    let result = mail_jobs::Entity::update_many()
        .col_expr(mail_jobs::Column::Status, Expr::value(status))
        .col_expr(mail_jobs::Column::Attempts, Expr::value(attempts))
        .col_expr(mail_jobs::Column::NextAttemptAt, Expr::value(next))
        .col_expr(mail_jobs::Column::LastError, Expr::value(error))
        .col_expr(mail_jobs::Column::LeaseToken, Expr::value(None::<String>))
        .col_expr(
            mail_jobs::Column::LeaseUntil,
            Expr::value(None::<NaiveDateTime>),
        )
        .col_expr(mail_jobs::Column::UpdatedAt, Expr::value(now))
        .filter(mail_jobs::Column::Id.eq(&job.id))
        .filter(mail_jobs::Column::Status.eq("processing"))
        .filter(mail_jobs::Column::LeaseToken.eq(job.lease_token.clone()))
        .exec(db)
        .await?;
    Ok(result.rows_affected == 1)
}

pub enum Outcome {
    Sent,
    Cancelled,
    Paused,
    Waiting,
    Failed(&'static str),
}

pub async fn cleanup<C: ConnectionTrait>(db: &C, now: NaiveDateTime) -> Result<(), AppError> {
    mail_jobs::Entity::delete_many()
        .filter(mail_jobs::Column::Status.is_in(["sent", "failed", "cancelled"]))
        .filter(mail_jobs::Column::UpdatedAt.lt(now - Duration::days(30)))
        .exec(db)
        .await?;
    Ok(())
}

pub async fn status<C: ConnectionTrait>(db: &C) -> Result<MailStatusResponse, AppError> {
    let pending = mail_jobs::Entity::find()
        .filter(mail_jobs::Column::Status.is_in(["pending", "waiting_approval", "processing"]))
        .count(db)
        .await?;
    let failed = mail_jobs::Entity::find()
        .filter(mail_jobs::Column::Status.eq("failed"))
        .count(db)
        .await?;
    let success = mail_jobs::Entity::find()
        .filter(mail_jobs::Column::Status.eq("sent"))
        .order_by_desc(mail_jobs::Column::UpdatedAt)
        .one(db)
        .await?;
    let error = mail_jobs::Entity::find()
        .filter(mail_jobs::Column::LastError.is_not_null())
        .order_by_desc(mail_jobs::Column::UpdatedAt)
        .one(db)
        .await?;
    Ok(MailStatusResponse {
        pending,
        failed,
        last_success_at: success.map(|j| j.updated_at),
        last_error: error.and_then(|j| j.last_error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DbBackend, QueryTrait};

    #[test]
    fn event_insert_sql_preserves_mysql_and_other_backend_conflict_semantics() {
        let model = mail_jobs::ActiveModel {
            id: Set("event-id".into()),
            event_key: Set("admin:comment-id".into()),
            ..Default::default()
        };
        let mysql = event_insert(model.clone())
            .build(DbBackend::MySql)
            .to_string();
        assert!(
            mysql.ends_with("ON DUPLICATE KEY UPDATE `id` = `id`"),
            "{mysql}"
        );
        for backend in [DbBackend::Sqlite, DbBackend::Postgres] {
            let sql = event_insert(model.clone()).build(backend).to_string();
            assert!(
                sql.ends_with("ON CONFLICT (\"event_key\") DO NOTHING"),
                "{sql}"
            );
        }
    }
}
