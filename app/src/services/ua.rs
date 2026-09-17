//! User-Agent 解析：把原始 UA 字符串压缩成可读摘要（如 `Chrome 126 · Windows`）。
//!
//! 定位是「展示用摘要」而非精确解析：手写轻量子集识别（零依赖），只覆盖主流
//! 浏览器与操作系统；识别不出浏览器、机器人 UA、空串一律返回 `None`，前端
//! 不渲染（专有名词直出，无 i18n 问题）。Chromium UA 冻结后 minor 已无意义，
//! 版本只取 major。

/// 解析 UA 为可读摘要：`"<Browser> <major> · <OS>"`，OS 未识别时只显示浏览器。
/// 仅用于公共/管理响应的 `ua_summary` 展示字段，原始 `ua` 仍完整保留在库与管理响应中。
pub(crate) fn parse_ua(ua: &str) -> Option<String> {
    // 统一小写后做子串匹配；数字与分隔符不受影响，版本提取在串内进行
    let lower = ua.trim().to_ascii_lowercase();
    if lower.is_empty() || is_bot(&lower) {
        return None;
    }
    let browser = parse_browser(&lower)?;
    match parse_os(&lower) {
        Some(os) => Some(format!("{browser} · {os}")),
        None => Some(browser),
    }
}

/// 明确的机器人/工具特征（子串匹配，小写输入）。评论场景下这些 UA 无展示价值
fn is_bot(lower: &str) -> bool {
    const BOT_TOKENS: &[&str] = &[
        "bot",
        "spider",
        "crawl",
        "slurp",
        "headless",
        "phantomjs",
        "curl",
        "wget",
        "python-requests",
        "okhttp",
        "facebookexternalhit",
        "bingpreview",
    ];
    BOT_TOKENS.iter().any(|t| lower.contains(t))
}

/// 在 ua 中定位 `token`（如 `chrome/`），取其后连续数字（major 版本）
fn major_after<'a>(ua: &'a str, token: &str) -> Option<&'a str> {
    let idx = ua.find(token)?;
    let rest = &ua[idx + token.len()..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    let digits = &rest[..end];
    (!digits.is_empty()).then_some(digits)
}

/// 浏览器识别（小写输入）。顺序即优先级：Edge/Opera 的 UA 里也含 `chrome/`，
/// 必须先于 Chrome 判定；版本号缺失时只展示浏览器名。Safari 依赖
/// `version/` + `safari/` 共存（排除 WebView），无版本则不识别
fn parse_browser(lower: &str) -> Option<String> {
    const BROWSERS: &[(&str, &[&str])] = &[
        ("Edge", &["edg/", "edgios/", "edge/"]),
        ("Opera", &["opr/", "opera/"]),
        ("Firefox", &["firefox/", "fxios/"]),
        // iOS Chrome（CriOS）先于桌面 Chrome/；两者 UA 均含 Safari/ 兜底标记
        ("Chrome", &["crios/", "chrome/"]),
    ];
    for (name, tokens) in BROWSERS {
        if let Some(tok) = tokens.iter().find(|t| lower.contains(*t)) {
            return match major_after(lower, tok) {
                Some(v) => Some(format!("{name} {v}")),
                None => Some((*name).to_owned()),
            };
        }
    }
    if lower.contains("safari/")
        && let Some(v) = major_after(lower, "version/")
    {
        return Some(format!("Safari {v}"));
    }
    None
}

/// 操作系统识别（小写输入）。Android 须先于 Linux（Android UA 含 Linux）；
/// iPhone/iPad 统一显示 iOS；Windows NT 冻结后 10/11 不可区分，不标版本
fn parse_os(lower: &str) -> Option<&'static str> {
    if lower.contains("windows") {
        return Some("Windows");
    }
    if lower.contains("iphone") || lower.contains("ipad") || lower.contains("ipod") {
        return Some("iOS");
    }
    if lower.contains("android") {
        return Some("Android");
    }
    if lower.contains("macintosh") || lower.contains("mac os x") {
        return Some("macOS");
    }
    if lower.contains("linux") || lower.contains("x11") {
        return Some("Linux");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_ua;

    #[test]
    fn mainstream_browsers() {
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            Some("Chrome 126 · Windows".to_owned())
        );
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
            ),
            Some("Edge 126 · macOS".to_owned())
        );
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0"
            ),
            Some("Opera 112 · Windows".to_owned())
        );
        assert_eq!(
            parse_ua("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"),
            Some("Firefox 128 · Linux".to_owned())
        );
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
            ),
            Some("Safari 17 · macOS".to_owned())
        );
    }

    #[test]
    fn mobile_browsers() {
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
            ),
            Some("Chrome 126 · Android".to_owned())
        );
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
            ),
            Some("Safari 17 · iOS".to_owned())
        );
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15"
            ),
            Some("Firefox 126 · iOS".to_owned())
        );
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.114 Mobile/15E148 Safari/604.1"
            ),
            Some("Chrome 126 · iOS".to_owned())
        );
    }

    #[test]
    fn bots_and_unrecognizable_yield_none() {
        assert_eq!(
            parse_ua("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
            None
        );
        assert_eq!(
            parse_ua("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0.0.0"),
            None
        );
        assert_eq!(parse_ua("curl/8.4.0"), None);
        assert_eq!(parse_ua("some random string"), None);
        assert_eq!(parse_ua(""), None);
        assert_eq!(parse_ua("   "), None);
    }

    #[test]
    fn degraded_and_edge_cases() {
        // 浏览器可识别但 OS 缺失：只显示浏览器
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            Some("Chrome 126".to_owned())
        );
        // 全小写 UA 同样识别
        assert_eq!(
            parse_ua(
                "mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/126.0.0.0 safari/537.36"
            ),
            Some("Chrome 126 · Windows".to_owned())
        );
        // 版本号缺失（手工构造串）：不展示版本，仅浏览器名 + OS
        assert_eq!(
            parse_ua("Mozilla/5.0 (Windows NT 10.0) Chrome/ Safari/537.36"),
            Some("Chrome · Windows".to_owned())
        );
        // Safari 无 Version/（WebView）不识别
        assert_eq!(
            parse_ua(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1"
            ),
            None
        );
    }
}
