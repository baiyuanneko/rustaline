use crate::{
    config::MailConfig,
    entities::{comments, mail_jobs},
};

fn page_url(mail: &MailConfig, comment: &comments::Model) -> String {
    let Ok(base) = url::Url::parse(&mail.site_url) else {
        return String::new();
    };
    if !matches!(base.scheme(), "http" | "https") {
        return String::new();
    }
    let Ok(mut page) = base.join(&comment.url) else {
        return String::new();
    };
    if !matches!(page.scheme(), "http" | "https") {
        return String::new();
    }
    page.set_fragment(Some(&format!("comment-{}", comment.id)));
    page.to_string()
}

pub fn notification(
    mail: &MailConfig,
    job: &mail_jobs::Model,
    comment: &comments::Model,
) -> (String, String) {
    let site = if mail.site_name.is_empty() {
        "Rustaline"
    } else {
        &mail.site_name
    };
    let page = page_url(mail, comment);
    let english = mail.language == "en";
    let subject = match (job.kind.as_str(), english) {
        ("reply", true) => format!("[{site}] New reply to your comment"),
        ("reply", false) => format!("[{site}] 您的评论收到了回复"),
        (_, true) => format!("[{site}] New comment"),
        (_, false) => format!("[{site}] 新评论提醒"),
    };
    let body = if english {
        format!(
            "Author: {}\n\n{}\n\nPage: {}\nStatus: {}\n",
            comment.nick, comment.comment, page, comment.status
        )
    } else {
        let status = match comment.status.as_str() {
            "approved" => "已公开",
            "pending" => "待审核",
            _ => "垃圾评论",
        };
        format!(
            "作者：{}\n\n{}\n\n页面：{}\n状态：{}\n",
            comment.nick, comment.comment, page, status
        )
    };
    (subject, body)
}

pub fn test(mail: &MailConfig) -> (String, String) {
    if mail.language == "en" {
        (
            "Rustaline SMTP test".into(),
            "Your saved SMTP settings are working.".into(),
        )
    } else {
        (
            "Rustaline SMTP 测试邮件".into(),
            "当前已保存的 SMTP 设置可以正常发送邮件。".into(),
        )
    }
}
