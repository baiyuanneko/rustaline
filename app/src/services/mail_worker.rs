//! 后台 SMTP 工作者；每封重新读取业务设置，关闭/损坏密码仅暂停。
use super::{
    mail_queue::{self, Outcome},
    mail_service, mail_templates, mail_transport, settings_service,
};
use crate::{
    entities::{comments, mail_jobs},
    error::AppError,
    state::AppState,
};
use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};
use tokio::{sync::watch, task::JoinHandle};

pub struct MailWorker {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl MailWorker {
    pub async fn shutdown(self) {
        let _ = self.stop.send(true);
        let _ = self.task.await;
    }
}

pub fn spawn_worker(state: AppState) -> MailWorker {
    let (stop, mut shutdown) = watch::channel(false);
    let task = tokio::spawn(async move {
        let mut cleanup_at = tokio::time::Instant::now();
        loop {
            if *shutdown.borrow() {
                break;
            }
            if cleanup_at.elapsed() >= std::time::Duration::from_secs(3600) {
                if let Err(error) = mail_queue::cleanup(&state.db, Utc::now().naive_utc()).await {
                    tracing::error!(error = ?error, "mail queue cleanup failed");
                }
                cleanup_at = tokio::time::Instant::now();
            }
            match process_once(&state.db, &state.config.jwt.secret).await {
                Ok(true) => continue,
                Ok(false) => {}
                Err(error) => {
                    tracing::error!(error = ?error, "mail queue database operation failed")
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {},
                _ = shutdown.changed() => break,
            }
        }
    });
    MailWorker { stop, task }
}

/// 返回是否处理了一条任务；SMTP 网络调用独立于评论提交事务。
pub async fn process_once(db: &DatabaseConnection, jwt_secret: &str) -> Result<bool, AppError> {
    let settings = settings_service::load(db, jwt_secret).await?;
    if mail_service::paused(&settings) {
        return Ok(false);
    }
    let Some(job) = mail_queue::claim(db, Utc::now().naive_utc()).await? else {
        return Ok(false);
    };
    // 领取后再取最新设置，防上一封发送期间后台关闭 SMTP。
    let settings = settings_service::load(db, jwt_secret).await?;
    if mail_service::paused(&settings) {
        mail_queue::finish(db, &job, Outcome::Paused, Utc::now().naive_utc()).await?;
        return Ok(false);
    }
    let Some(comment) = comments::Entity::find_by_id(&job.comment_id)
        .one(db)
        .await?
    else {
        mail_queue::finish(db, &job, Outcome::Cancelled, Utc::now().naive_utc()).await?;
        return Ok(true);
    };
    if let Some(outcome) = eligibility(db, &job, &comment, &settings.mail).await? {
        mail_queue::finish(db, &job, outcome, Utc::now().naive_utc()).await?;
        return Ok(true);
    }
    let (subject, body) = mail_templates::notification(&settings.mail, &job, &comment);
    let result =
        match mail_transport::message(&settings.mail, &job.recipient, &job.id, subject, body) {
            Ok(message) => mail_transport::send(&settings.mail, message).await,
            Err(error) => Err(error),
        };
    let txn = db.begin().await?;
    let sent = result.is_ok();
    let outcome = match result {
        Ok(()) => Outcome::Sent,
        Err(error) => Outcome::Failed(error),
    };
    let owned = mail_queue::finish(&txn, &job, outcome, Utc::now().naive_utc()).await?;
    if sent && owned && job.kind == "reply" {
        comments::Entity::update_many()
            .col_expr(comments::Column::IsNotified, Expr::value(true))
            .filter(comments::Column::Id.eq(&job.comment_id))
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(true)
}

async fn eligibility(
    db: &DatabaseConnection,
    job: &mail_jobs::Model,
    comment: &comments::Model,
    mail: &crate::config::MailConfig,
) -> Result<Option<Outcome>, AppError> {
    if comment.status == "spam" {
        return Ok(Some(Outcome::Cancelled));
    }
    if job.kind == "admin" {
        return Ok((!mail.notify_admin).then_some(Outcome::Cancelled));
    }
    if job.kind != "reply" || !mail.notify_reply {
        return Ok(Some(Outcome::Cancelled));
    }
    if comment.status != "approved" {
        return Ok(Some(Outcome::Waiting));
    }
    if comment.pid != job.parent_id {
        return Ok(Some(Outcome::Cancelled));
    }
    let Some(pid) = &job.parent_id else {
        return Ok(Some(Outcome::Cancelled));
    };
    let Some(parent) = comments::Entity::find_by_id(pid).one(db).await? else {
        return Ok(Some(Outcome::Cancelled));
    };
    if parent.status != "approved"
        || !parent.reply_notification
        || parent.mail.as_deref() != Some(job.recipient.as_str())
        || comment
            .mail
            .as_ref()
            .is_some_and(|own| own.trim().eq_ignore_ascii_case(job.recipient.trim()))
    {
        return Ok(Some(Outcome::Cancelled));
    }
    Ok(None)
}
