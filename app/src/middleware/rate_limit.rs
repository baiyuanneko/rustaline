//! 评论提交限流：内存滑动窗口，单 IP 每分钟最多 N 次（N = config.comment.rate_limit_per_minute）。
//! 仅挂在 POST /api/v1/comments 上。

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, State};
use axum::http::{Extensions, HeaderMap};
use axum::middleware::Next;
use axum::response::Response;

use crate::error::AppError;
use crate::state::AppState;

const WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone, Default)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<IpAddr, VecDeque<Instant>>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// 返回 true 表示允许请求；false 表示已超限。
    pub fn check(&self, ip: IpAddr, max: u32) -> bool {
        let mut map = self.inner.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();
        let queue = map.entry(ip).or_default();
        while let Some(&front) = queue.front() {
            if now.duration_since(front) >= WINDOW {
                queue.pop_front();
            } else {
                break;
            }
        }
        if queue.len() >= max as usize {
            return false;
        }
        queue.push_back(now);
        true
    }
}

/// axum middleware：从 ConnectInfo 或 X-Forwarded-For 取 IP，超限返回 429。
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = extract_client_ip(request.headers(), request.extensions())
        .unwrap_or_else(|| "0.0.0.0".parse().expect("static ip"));
    let max = state.config.comment.rate_limit_per_minute;
    if !state.comment_rate_limiter.check(ip, max) {
        return Err(AppError::TooManyRequests(
            "comment rate limit exceeded, try again later".into(),
        ));
    }
    Ok(next.run(request).await)
}

/// 登录接口限流上限：固定 5 次/分钟/IP（M-1 防爆破）。
/// 与评论限流各自独立计数；凭据对错都计数（中间件在认证逻辑之前拦截）。
const LOGIN_MAX_PER_MINUTE: u32 = 5;

/// 验证码签发接口限流上限：固定 60 次/分钟/IP。
/// 图形码生成有 CPU 成本、PoW 签发接口需防批量囤积，故各自独立限流。
const CAPTCHA_ISSUE_MAX_PER_MINUTE: u32 = 60;

/// PoW challenge 签发限流 middleware，仅挂在 GET /api/v1/captcha/pow 上。
pub async fn pow_issue_rate_limit_middleware(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    run_issue_limit(&state.pow_issue_rate_limiter, request, next).await
}

/// 图形验证码签发限流 middleware，仅挂在 GET /api/v1/captcha/image 上。
pub async fn image_issue_rate_limit_middleware(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    run_issue_limit(&state.image_issue_rate_limiter, request, next).await
}

async fn run_issue_limit(
    limiter: &RateLimiter,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = extract_client_ip(request.headers(), request.extensions())
        .unwrap_or_else(|| "0.0.0.0".parse().expect("static ip"));
    if !limiter.check(ip, CAPTCHA_ISSUE_MAX_PER_MINUTE) {
        return Err(AppError::TooManyRequests(
            "captcha issue rate limit exceeded, try again later".into(),
        ));
    }
    Ok(next.run(request).await)
}

/// 登录限流 middleware，仅挂在 POST /api/v1/auth/login 上。
pub async fn login_rate_limit_middleware(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = extract_client_ip(request.headers(), request.extensions())
        .unwrap_or_else(|| "0.0.0.0".parse().expect("static ip"));
    if !state.login_rate_limiter.check(ip, LOGIN_MAX_PER_MINUTE) {
        return Err(AppError::TooManyRequests(
            "login rate limit exceeded, try again later".into(),
        ));
    }
    Ok(next.run(request).await)
}

/// 取客户端 IP：优先 ConnectInfo（socket addr，由 into_make_service_with_connect_info 注入），
/// 其次 X-Forwarded-For（反向代理场景）。两者均不可得时返回 None。
pub fn extract_client_ip(headers: &HeaderMap, ext: &Extensions) -> Option<IpAddr> {
    if let Some(ci) = ext.get::<ConnectInfo<SocketAddr>>() {
        return Some(ci.0.ip());
    }
    if let Some(xff) = headers.get("x-forwarded-for")
        && let Ok(s) = xff.to_str()
        && let Some(first) = s.split(',').next()
        && let Ok(ip) = first.trim().parse::<IpAddr>()
    {
        return Some(ip);
    }
    None
}

/// 复用 extract_client_ip 的 extractor，供 handler 注入客户端 IP。
#[derive(Debug, Clone)]
pub struct ClientIp(pub String);

impl axum::extract::FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ip = extract_client_ip(&parts.headers, &parts.extensions)
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "0.0.0.0".into());
        Ok(ClientIp(ip))
    }
}
