//! SMTP 只返回固定错误类别，不传播远端回复、密码或邮件正文。
use crate::config::MailConfig;
use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::time::Duration;

pub fn message(
    mail: &MailConfig,
    to: &str,
    id: &str,
    subject: String,
    body: String,
) -> Result<Message, &'static str> {
    let from = mail
        .from_email
        .parse()
        .map_err(|_| "invalid_mail_configuration")?;
    let to = to.parse().map_err(|_| "invalid_recipient")?;
    Message::builder()
        .from(Mailbox::new(Some(mail.from_name.clone()), from))
        .to(Mailbox::new(None, to))
        .message_id(Some(format!("<{id}@rustaline.local>")))
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|_| "invalid_mail_configuration")
}

pub async fn send(mail: &MailConfig, message: Message) -> Result<(), &'static str> {
    let builder = match mail.security.as_str() {
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&mail.host),
        "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&mail.host),
        "none" => Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
            &mail.host,
        )),
        _ => return Err("invalid_mail_configuration"),
    }
    .map_err(|_| "invalid_mail_configuration")?;
    let mut builder = builder
        .port(mail.port)
        .timeout(Some(Duration::from_secs(30)));
    if !mail.username.is_empty() {
        if mail.password.is_empty() {
            return Err("smtp_password_missing");
        }
        builder = builder.credentials(Credentials::new(
            mail.username.clone(),
            mail.password.clone(),
        ));
    }
    let transport = builder.build();
    let mut accepted = false;
    // 网络发送和连接池关闭共用总时限，远端 QUIT 不响应也不会挂住退出。
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        let result = transport.send(message).await;
        accepted = result.is_ok();
        transport.shutdown().await;
        result
    })
    .await;
    match result {
        Err(_) if accepted => Ok(()),
        Err(_) => Err("smtp_timeout"),
        Ok(Err(error)) => {
            if error.is_timeout() {
                Err("smtp_timeout")
            } else if error.is_permanent() {
                Err("smtp_rejected")
            } else if error.is_transient() {
                Err("smtp_temporarily_unavailable")
            } else {
                Err("smtp_connection_failed")
            }
        }
        Ok(Ok(_)) => Ok(()),
    }
}
