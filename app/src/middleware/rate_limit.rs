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
    let ip = extract_client_ip(
        request.headers(),
        request.extensions(),
        state.config.server.trust_xff,
    )
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
    run_issue_limit(
        &state.pow_issue_rate_limiter,
        state.config.server.trust_xff,
        request,
        next,
    )
    .await
}

/// 图形验证码签发限流 middleware，仅挂在 GET /api/v1/captcha/image 上。
pub async fn image_issue_rate_limit_middleware(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    run_issue_limit(
        &state.image_issue_rate_limiter,
        state.config.server.trust_xff,
        request,
        next,
    )
    .await
}

async fn run_issue_limit(
    limiter: &RateLimiter,
    trust_xff: bool,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = extract_client_ip(request.headers(), request.extensions(), trust_xff)
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
    let ip = extract_client_ip(
        request.headers(),
        request.extensions(),
        state.config.server.trust_xff,
    )
    .unwrap_or_else(|| "0.0.0.0".parse().expect("static ip"));
    if !state.login_rate_limiter.check(ip, LOGIN_MAX_PER_MINUTE) {
        return Err(AppError::TooManyRequests(
            "login rate limit exceeded, try again later".into(),
        ));
    }
    Ok(next.run(request).await)
}

/// 取客户端 IP：
/// - `trust_xff = true`（反代部署，server.trust_xff）：取 X-Forwarded-For **最右侧**
///   可解析条目 —— 标准反代会把真实客户端 IP 追加到链尾，取首项会被客户端伪造。
///   XFF 缺失或全部解析失败时回退 ConnectInfo 对端 IP。
/// - `trust_xff = false`（默认）：返回 ConnectInfo 对端 IP，忽略 XFF（防伪造）；
///   无 ConnectInfo 的测试路径（oneshot）回退取 XFF 首项，保持既有集成测试语义。
pub fn extract_client_ip(headers: &HeaderMap, ext: &Extensions, trust_xff: bool) -> Option<IpAddr> {
    let peer = ext.get::<ConnectInfo<SocketAddr>>().map(|ci| ci.0.ip());
    if trust_xff {
        return rightmost_xff_ip(headers).or(peer);
    }
    peer.or_else(|| leftmost_xff_ip(headers))
}

/// XFF 首项（仅用于无 ConnectInfo 的测试路径回退）
fn leftmost_xff_ip(headers: &HeaderMap) -> Option<IpAddr> {
    let s = headers.get("x-forwarded-for")?.to_str().ok()?;
    s.split(',').next()?.trim().parse::<IpAddr>().ok()
}

/// XFF 最右侧可解析条目；畸形条目跳过，全部畸形则 None
fn rightmost_xff_ip(headers: &HeaderMap) -> Option<IpAddr> {
    let s = headers.get("x-forwarded-for")?.to_str().ok()?;
    s.rsplit(',')
        .find_map(|part| part.trim().parse::<IpAddr>().ok())
}

/// 复用 extract_client_ip 的 extractor，供 handler 注入客户端 IP。
#[derive(Debug, Clone)]
pub struct ClientIp(pub String);

impl axum::extract::FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ip = extract_client_ip(
            &parts.headers,
            &parts.extensions,
            state.config.server.trust_xff,
        )
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "0.0.0.0".into());
        Ok(ClientIp(ip))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers_with_xff(xff: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_str(xff).unwrap());
        headers
    }

    fn ext_with_peer(ip: &str) -> Extensions {
        let mut ext = Extensions::new();
        ext.insert(ConnectInfo(SocketAddr::new(ip.parse().unwrap(), 12345)));
        ext
    }

    /// 默认（trust_xff=false）：ConnectInfo 对端 IP 优先，伪造的 XFF 被忽略
    #[test]
    fn untrusted_mode_ignores_xff() {
        let headers = headers_with_xff("203.0.113.9");
        let ext = ext_with_peer("10.0.0.1");
        assert_eq!(
            extract_client_ip(&headers, &ext, false),
            Some("10.0.0.1".parse().unwrap())
        );
    }

    /// 默认模式 + 无 ConnectInfo（oneshot 测试路径）：回退取 XFF 首项（既有语义）
    #[test]
    fn untrusted_mode_falls_back_to_xff_without_connect_info() {
        let headers = headers_with_xff("203.0.113.9, 10.0.0.1");
        let ext = Extensions::new();
        assert_eq!(
            extract_client_ip(&headers, &ext, false),
            Some("203.0.113.9".parse().unwrap())
        );
    }

    /// 反代模式（trust_xff=true）：取 XFF 最右侧条目（反代追加的真实客户端 IP），
    /// 客户端伪造的左側条目不生效
    #[test]
    fn trusted_mode_takes_rightmost_xff() {
        let headers = headers_with_xff("203.0.113.9, 198.51.100.7");
        let ext = ext_with_peer("10.0.0.1");
        assert_eq!(
            extract_client_ip(&headers, &ext, true),
            Some("198.51.100.7".parse().unwrap())
        );
    }

    /// 反代模式 + XFF 缺失：回退 ConnectInfo 对端 IP
    #[test]
    fn trusted_mode_falls_back_to_peer_without_xff() {
        let ext = ext_with_peer("10.0.0.1");
        assert_eq!(
            extract_client_ip(&HeaderMap::new(), &ext, true),
            Some("10.0.0.1".parse().unwrap())
        );
    }

    /// 反代模式 + XFF 全部畸形：跳过畸形条目取最右可解析项，全畸形则回退 peer
    #[test]
    fn trusted_mode_skips_malformed_xff_entries() {
        let ext = ext_with_peer("10.0.0.1");
        let headers = headers_with_xff("203.0.113.9, garbage");
        assert_eq!(
            extract_client_ip(&headers, &ext, true),
            Some("203.0.113.9".parse().unwrap())
        );
        let headers = headers_with_xff("garbage, also-garbage");
        assert_eq!(
            extract_client_ip(&headers, &ext, true),
            Some("10.0.0.1".parse().unwrap())
        );
    }

    /// 反代模式 + 无 ConnectInfo：仍取 XFF 最右侧
    #[test]
    fn trusted_mode_without_connect_info() {
        let headers = headers_with_xff("203.0.113.9, 198.51.100.7");
        let ext = Extensions::new();
        assert_eq!(
            extract_client_ip(&headers, &ext, true),
            Some("198.51.100.7".parse().unwrap())
        );
    }

    /// 两者均无：None（调用方兜底 0.0.0.0）
    #[test]
    fn no_source_returns_none() {
        for trust_xff in [false, true] {
            assert_eq!(
                extract_client_ip(&HeaderMap::new(), &Extensions::new(), trust_xff),
                None
            );
        }
    }
}
