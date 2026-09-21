//! 评论验证码：PoW（SHA-256 hashcash，HMAC 签名 challenge）+ 图形验证码。
//!
//! 两套机制相互独立、分别由 config.comment.captcha 下的开关控制，同时开启时为 AND。
//! 凭证状态 Redis 优先（`state.redis`），Redis 不可达时降级为进程内存储
//! （多副本部署必须提供 Redis，内存路径不跨实例共享，与 IP 限流同口径）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::config::CaptchaConfig;
use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;

/// HMAC 签名密钥域分离标签：captcha.secret 缺省时由 jwt.secret 派生子密钥
const DERIVE_LABEL: &[u8] = b"rustaline-captcha-v1";

/// 内存表同时存活条目上限（正常 TTL 下远低于此，主要防异常膨胀）
const MEMORY_CAP: usize = 100_000;

/// 服务端计算 PoW 时允许的最大 nonce（防止垃圾值；难度 ≤8 时 2^32 足够）
const MAX_NONCE: u64 = u32::MAX as u64;

// ---- 密钥 -----------------------------------------------------------------

/// 解析 captcha HMAC 密钥：显式配置优先；缺省由 jwt.secret 做 HMAC 域分离派生
pub fn signing_key(config: &CaptchaConfig, jwt_secret: &str) -> Vec<u8> {
    if !config.secret.is_empty() {
        return config.secret.as_bytes().to_vec();
    }
    let mut mac = HmacSha256::new_from_slice(jwt_secret.as_bytes()).expect("HMAC 接受任意长度密钥");
    mac.update(DERIVE_LABEL);
    mac.finalize().into_bytes().to_vec()
}

// ---- 时间工具 -------------------------------------------------------------

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

// ---- PoW 签名 challenge ----------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct PowTokenPayload {
    v: u8,
    /// 16 随机字节 hex，challenge 唯一标识，也是防重放存储键
    rnd: String,
    iat: u64,
    exp: u64,
    /// bind_ip=true 时为签发时客户端 IP 的 SHA-256 hex
    #[serde(skip_serializing_if = "Option::is_none", default)]
    ip: Option<String>,
}

fn b64url_encode<T: Serialize>(value: &T) -> String {
    let json = serde_json::to_vec(value).expect("token payload 序列化不会失败");
    URL_SAFE_NO_PAD.encode(json)
}

fn b64url_decode<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, AppError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(raw.as_bytes())
        .map_err(|_| AppError::BadRequest("pow verification failed".into()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::BadRequest("pow verification failed".into()))
}

/// 签发无状态签名 challenge：`base64url(payload).base64url(HMAC(payload))`。
/// 签发不产生任何服务端状态，消费（防重放）发生在提交校验时。
pub fn issue_pow_challenge(key: &[u8], config: &CaptchaConfig, client_ip: &str) -> String {
    let now = now_secs();
    let mut random = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut random);
    let payload = PowTokenPayload {
        v: 1,
        rnd: hex_lower(&random),
        iat: now,
        exp: now + config.pow_ttl_secs.max(1),
        ip: if config.bind_ip {
            Some(hex_lower(&Sha256::digest(client_ip.as_bytes())))
        } else {
            None
        },
    };
    let payload_b64 = b64url_encode(&payload);
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC 接受任意长度密钥");
    mac.update(payload_b64.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{payload_b64}.{sig_b64}")
}

/// 解析 challenge 令牌（验签 + 过期 + 可选 IP 绑定）。
/// 错误一律映射为同一个 BadRequest，不向客户端区分错因。
fn verify_pow_token(
    key: &[u8],
    challenge: &str,
    client_ip: &str,
) -> Result<PowTokenPayload, AppError> {
    let (payload_b64, sig_b64) = challenge
        .split_once('.')
        .ok_or_else(|| AppError::BadRequest("pow verification failed".into()))?;
    if payload_b64.len() > 4096 || sig_b64.len() > 128 {
        return Err(AppError::BadRequest("pow verification failed".into()));
    }
    let sig = URL_SAFE_NO_PAD
        .decode(sig_b64.as_bytes())
        .map_err(|_| AppError::BadRequest("pow verification failed".into()))?;
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC 接受任意长度密钥");
    mac.update(payload_b64.as_bytes());
    // 常量时间比较，避免签名校验侧信道
    if mac.verify_slice(&sig).is_err() {
        return Err(AppError::BadRequest("pow verification failed".into()));
    }
    let payload: PowTokenPayload = b64url_decode(payload_b64)?;
    let now = now_secs();
    if payload.v != 1 || payload.rnd.len() != 32 || payload.exp <= now || payload.iat > now + 60 {
        return Err(AppError::BadRequest("pow verification failed".into()));
    }
    if let Some(bound_ip) = payload.ip.as_ref() {
        let current = hex_lower(&Sha256::digest(client_ip.as_bytes()));
        if bound_ip.as_bytes().ct_eq(current.as_bytes()).unwrap_u8() != 1 {
            return Err(AppError::BadRequest("pow verification failed".into()));
        }
    }
    Ok(payload)
}

/// 校验哈希前导零：十六进制结果前 difficulty 个字符必须全为 '0'。
fn has_enough_leading_zeros(hash_hex: &str, difficulty: u32) -> bool {
    let n = difficulty as usize;
    hash_hex.len() >= n && hash_hex.as_bytes()[..n].iter().all(|&c| c == b'0')
}

// ---- 进程内凭证存储（Redis 不可用时的降级路径） ---------------------------

#[derive(Default)]
pub struct CaptchaMemoryStore {
    /// PoW 已消费 challenge：rnd -> 过期时间戳
    pow: Mutex<HashMap<String, u64>>,
    /// 图形码：id -> (小写答案, 剩余尝试次数, 过期时间戳)
    image: Mutex<HashMap<String, (String, u32, u64)>>,
}

impl CaptchaMemoryStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn prune(map: &mut HashMap<String, u64>, now: u64) {
        map.retain(|_, exp| *exp > now);
        // 容量保护：仍超限时丢弃最早过期的条目
        if map.len() > MEMORY_CAP {
            let mut entries: Vec<(String, u64)> = map.drain().collect();
            entries.sort_unstable_by_key(|(_, exp)| *exp);
            for (k, v) in entries.into_iter().take(MEMORY_CAP) {
                map.insert(k, v);
            }
        }
    }

    /// 原子消费 challenge：true = 首次使用；false = 重放
    fn consume_pow(&self, rnd: &str, exp: u64, ttl_secs: u64) -> bool {
        let now = now_secs();
        let mut map = self.pow.lock().expect("captcha store mutex poisoned");
        Self::prune(&mut map, now);
        if map.contains_key(rnd) {
            return false;
        }
        if map.len() >= MEMORY_CAP {
            return false;
        }
        map.insert(rnd.to_owned(), exp.max(now + ttl_secs));
        true
    }

    fn put_image(&self, id: &str, answer: &str, attempts: u32, exp: u64) {
        let mut map = self.image.lock().expect("captcha store mutex poisoned");
        if map.len() >= MEMORY_CAP {
            let now = now_secs();
            map.retain(|_, (_, _, e)| *e > now);
        }
        map.insert(id.to_owned(), (answer.to_owned(), attempts, exp));
    }

    /// 测试辅助：读取图形码内存表（集成测试需取出服务端持有的答案）
    #[doc(hidden)]
    pub fn image_store_for_test(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, (String, u32, u64)>> {
        self.image.lock().expect("captcha store mutex poisoned")
    }
}

// ---- 对外校验入口 ---------------------------------------------------------

/// 校验并消费 PoW 解。任何失败（缺字段/验签/过期/IP 不符/前导零不足/重放）
/// 均返回同一个 400，不区分错因；Redis 故障返回 500（fail-closed）。
pub async fn verify_pow(
    redis: &Option<ConnectionManager>,
    memory: &Arc<CaptchaMemoryStore>,
    key: &[u8],
    config: &CaptchaConfig,
    solution: Option<&PowSolutionInput>,
    client_ip: &str,
) -> Result<(), AppError> {
    if !config.pow_enabled {
        return Ok(());
    }
    let solution = solution
        .filter(|s| !s.challenge.is_empty())
        .ok_or_else(|| AppError::BadRequest("pow verification failed".into()))?;
    if solution.nonce > MAX_NONCE {
        return Err(AppError::BadRequest("pow verification failed".into()));
    }
    let payload = verify_pow_token(key, &solution.challenge, client_ip)?;

    // 客户端只提交 challenge + nonce，哈希由服务端重算（防伪造）
    let mut hasher = Sha256::new();
    hasher.update(solution.challenge.as_bytes());
    hasher.update(b":");
    hasher.update(solution.nonce.to_string().as_bytes());
    let hash_hex = hex_lower(&hasher.finalize());
    if !has_enough_leading_zeros(&hash_hex, config.pow_difficulty) {
        return Err(AppError::BadRequest("pow verification failed".into()));
    }

    // 防重放消费：Redis 原子 SET NX EX 优先
    let first_use = if let Some(conn) = redis {
        let mut conn = conn.clone();
        let key = format!("captcha:pow:{}", payload.rnd);
        // SET key 1 NX EX ttl：设置成功（首次）返回 "OK"，已存在返回 nil
        let res: Option<String> = redis::cmd("SET")
            .arg(&key)
            .arg("1")
            .arg("NX")
            .arg("EX")
            .arg(config.pow_ttl_secs)
            .query_async(&mut conn)
            .await?;
        res.is_some()
    } else {
        memory.consume_pow(&payload.rnd, payload.exp, config.pow_ttl_secs)
    };
    if !first_use {
        return Err(AppError::BadRequest("pow verification failed".into()));
    }
    Ok(())
}

/// 校验并消费图形验证码。正确或尝试次数耗尽都会删除凭证。
/// Redis 故障返回 500（fail-closed）。
pub async fn verify_image(
    redis: &Option<ConnectionManager>,
    memory: &Arc<CaptchaMemoryStore>,
    config: &CaptchaConfig,
    id: Option<&str>,
    code: Option<&str>,
) -> Result<(), AppError> {
    if !config.image_enabled {
        return Ok(());
    }
    let id = id.filter(|s| !s.is_empty()).ok_or_else(bad_captcha)?;
    let code = code.map(|s| s.trim().to_lowercase()).unwrap_or_default();
    if code.is_empty() {
        return Err(bad_captcha());
    }

    if let Some(conn) = redis {
        let mut conn = conn.clone();
        let key = format!("captcha:img:{id}");
        let stored: Option<String> = conn.get(&key).await?;
        let stored = stored.ok_or_else(bad_captcha)?;
        // 存储格式 "answer:attempts_left"，answer 仅含字母数字
        let (answer, attempts_left) = stored
            .rsplit_once(':')
            .and_then(|(a, n)| n.parse::<u32>().ok().map(|n| (a.to_owned(), n)))
            .ok_or_else(|| AppError::internal_msg("corrupted captcha record"))?;

        let matched = answer.as_bytes().ct_eq(code.as_bytes()).unwrap_u8() == 1;
        if matched {
            let _: i64 = conn.del(&key).await?;
            return Ok(());
        }
        if attempts_left <= 1 {
            let _: i64 = conn.del(&key).await?;
        } else {
            // 不重置 TTL：剩余总时长保持签发时的窗口
            let ttl: i64 = conn.ttl(&key).await?;
            if ttl > 0 {
                let _: () = conn
                    .set_ex(&key, format!("{answer}:{}", attempts_left - 1), ttl as u64)
                    .await?;
            }
        }
        return Err(bad_captcha());
    }

    // 内存降级路径：单次加锁完成「检查 -> 比对 -> 扣次/删除」
    let now = now_secs();
    let mut map = memory.image.lock().expect("captcha store mutex poisoned");
    map.retain(|_, (_, _, exp)| *exp > now);
    let Some((answer, attempts_left, _exp)) = map.get(id) else {
        return Err(bad_captcha());
    };
    let matched = answer.as_bytes().ct_eq(code.as_bytes()).unwrap_u8() == 1;
    if matched {
        map.remove(id);
        return Ok(());
    }
    if *attempts_left <= 1 {
        map.remove(id);
    } else {
        map.get_mut(id).expect("entry exists").1 -= 1;
    }
    Err(bad_captcha())
}

fn bad_captcha() -> AppError {
    AppError::BadRequest("captcha code invalid or expired".into())
}

// ---- 图形码签发 -----------------------------------------------------------

/// 图形码字符集：默认字体子集，额外剔除易混字符（2/Z、5/S、6/b、8/B、9/g、c 保留，
/// 去掉最易混的 0/O/1/I/l 已由字体保证，这里再去掉 2/Z、5/S、8/B）
const IMAGE_CHARSET: &[char] = &[
    '3', '4', '6', '7', '9', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'N', 'P', 'Q', 'R',
    'T', 'U', 'V', 'W', 'X', 'Y', 'a', 'd', 'e', 'f', 'h', 'k', 'm', 'n', 'r', 't', 'u', 'v', 'w',
    'x', 'y',
];

/// 签发图形码：生成 PNG（仅服务端持有答案），写入凭证存储。
/// 返回 (id, PNG 字节, ttl_secs)。
pub async fn issue_image_captcha(
    redis: &Option<ConnectionManager>,
    memory: &Arc<CaptchaMemoryStore>,
    config: &CaptchaConfig,
) -> Result<(String, Vec<u8>), AppError> {
    let (answer, png) = tokio::task::spawn_blocking(generate_image)
        .await
        .map_err(|_| AppError::internal_msg("captcha generation failed"))?
        .ok_or_else(|| AppError::internal_msg("captcha generation failed"))?;
    let answer = answer.to_lowercase();
    let id = Uuid::new_v4().to_string();
    let exp = now_secs() + config.image_ttl_secs;

    if let Some(conn) = redis {
        let mut conn = conn.clone();
        let key = format!("captcha:img:{id}");
        let _: () = conn
            .set_ex(
                &key,
                format!("{answer}:{}", config.image_max_attempts),
                config.image_ttl_secs,
            )
            .await?;
    } else {
        memory.put_image(&id, &answer, config.image_max_attempts, exp);
    }
    Ok((id, png))
}

/// 生成图形码 PNG（CPU/字体操作，调用方应放到阻塞线程池）。
///
/// 可读性优先的参数组合（字符在成品中占比越大越易读）：
/// - 4 位字符（39 字符集 → 39⁴ ≈ 230 万组合，配合签发/提交限流足够）
/// - 紧裁切 view(168, 64)：字符高 28px 占成品高度 44%（原先 220×120 裁切只占 23%）
/// - 仅横向 Wave、幅度 1.5 / 周期 28：去掉纵向扭曲（对识别率伤害最大的一项）
/// - Noise 0.15、Dots 8 且半径 2..=4：比 crate 自带 Easy 档（0.2 / 10 点）还轻一档
fn generate_image() -> Option<(String, Vec<u8>)> {
    use captcha::filters::{Dots, Noise, Wave};
    let mut captcha = captcha::Captcha::new();
    captcha
        .set_chars(IMAGE_CHARSET)
        .add_chars(4)
        .apply_filter(Noise::new(0.15))
        .apply_filter(Wave::new(1.5, 28.0).horizontal())
        .view(168, 64)
        .apply_filter(Dots::new(8).min_radius(2).max_radius(4));
    captcha.as_tuple()
}

// ---- DTO（service 层入参，handler DTO 转换） ------------------------------

#[derive(Debug, Clone)]
pub struct PowSolutionInput {
    pub challenge: String,
    pub nonce: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 读 PNG IHDR 宽高，验证图形码成品尺寸与 SDK 展示比例匹配
    fn png_dims(bytes: &[u8]) -> (u32, u32) {
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"), "应为 PNG");
        assert_eq!(&bytes[12..16], b"IHDR", "应为 IHDR 块");
        (
            u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]),
            u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]),
        )
    }

    #[test]
    fn generate_image_is_readable_format() {
        let (answer, png) = generate_image().expect("生成图形码");
        // 4 位去歧义字符（可读性优先的参数组合）
        assert_eq!(answer.chars().count(), 4, "应为 4 位字符");
        assert!(
            answer.chars().all(|c| IMAGE_CHARSET.contains(&c)),
            "答案字符应在去歧义字符集内: {answer}"
        );
        let (w, h) = png_dims(&png);
        assert_eq!(
            (w, h),
            (168, 64),
            "成品尺寸应为 168x64（与 SDK 展示比例匹配）"
        );
        // 宽高比约 2.625；SDK CSS 是 158x60（≈2.633）
        let ratio = w as f64 / h as f64;
        assert!(
            (ratio - 2.625).abs() < 0.01,
            "宽高比应 ≈2.625，实际 {ratio}"
        );
    }

    #[test]
    fn generate_image_is_stable_across_calls() {
        // 连续生成多次不 panic，且尺寸恒定
        for _ in 0..5 {
            let (answer, png) = generate_image().expect("生成图形码");
            assert_eq!(answer.chars().count(), 4);
            assert_eq!(png_dims(&png), (168, 64));
        }
    }

    fn test_config() -> CaptchaConfig {
        CaptchaConfig {
            pow_enabled: true,
            pow_difficulty: 4,
            pow_ttl_secs: 600,
            image_enabled: true,
            image_ttl_secs: 300,
            image_max_attempts: 3,
            bind_ip: false,
            secret: String::new(),
        }
    }

    fn solve(challenge: &str, difficulty: u32) -> u64 {
        for nonce in 0..u64::MAX {
            let mut h = Sha256::new();
            h.update(challenge.as_bytes());
            h.update(b":");
            h.update(nonce.to_string().as_bytes());
            let hash = hex_lower(&h.finalize());
            if has_enough_leading_zeros(&hash, difficulty) {
                return nonce;
            }
        }
        panic!("no nonce found");
    }

    #[test]
    fn challenge_roundtrip_signature() {
        let config = test_config();
        let key = signing_key(&config, "a-very-strong-jwt-secret-at-least-32-bytes!");
        let token = issue_pow_challenge(&key, &config, "1.2.3.4");
        let payload = verify_pow_token(&key, &token, "1.2.3.4").expect("valid token");
        assert_eq!(payload.rnd.len(), 32);

        // 篡改签名必须失败
        let tampered = format!("{token}x");
        assert!(verify_pow_token(&key, &tampered, "1.2.3.4").is_err());
        // 错误密钥必须失败
        let other = signing_key(&config, "b-very-strong-jwt-secret-at-least-32-bytes!");
        assert!(verify_pow_token(&other, &token, "1.2.3.4").is_err());
    }

    #[tokio::test]
    async fn pow_memory_path_accepts_and_blocks_replay() {
        let config = test_config();
        let key = signing_key(&config, "a-very-strong-jwt-secret-at-least-32-bytes!");
        let memory = CaptchaMemoryStore::new();
        let token = issue_pow_challenge(&key, &config, "1.2.3.4");
        let nonce = solve(&token, 4);
        let sol = PowSolutionInput {
            challenge: token.clone(),
            nonce,
        };
        verify_pow(&None, &memory, &key, &config, Some(&sol), "1.2.3.4")
            .await
            .expect("first use accepted");
        assert!(
            verify_pow(&None, &memory, &key, &config, Some(&sol), "1.2.3.4")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn pow_rejects_bad_nonce() {
        let config = test_config();
        let key = signing_key(&config, "a-very-strong-jwt-secret-at-least-32-bytes!");
        let memory = CaptchaMemoryStore::new();
        let token = issue_pow_challenge(&key, &config, "1.2.3.4");
        let sol = PowSolutionInput {
            challenge: token,
            nonce: 1,
        };
        assert!(
            verify_pow(&None, &memory, &key, &config, Some(&sol), "1.2.3.4")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn image_memory_path_lifecycle() {
        let config = test_config();
        let memory = CaptchaMemoryStore::new();
        let (id, png) = issue_image_captcha(&None, &memory, &config)
            .await
            .expect("issue");
        assert!(!png.is_empty());

        // 不存在的 id
        assert!(
            verify_image(&None, &memory, &config, Some("nope"), Some("abcd"))
                .await
                .is_err()
        );

        // 答案需要从内存里取（模拟服务端持有）：错误两次、第三次用对
        let answer = {
            let map = memory.image.lock().unwrap();
            map.get(&id).unwrap().0.clone()
        };
        let wrong = if answer == "zzzzz" { "aaaaa" } else { "zzzzz" };
        for _ in 0..2 {
            assert!(
                verify_image(&None, &memory, &config, Some(&id), Some(wrong))
                    .await
                    .is_err()
            );
        }
        // 第三次正确（上限 3 次：两错后仍有效）
        verify_image(
            &None,
            &memory,
            &config,
            Some(&id),
            Some(&answer.to_uppercase()),
        )
        .await
        .expect("case-insensitive match");
        // 一次性：复用失败
        assert!(
            verify_image(&None, &memory, &config, Some(&id), Some(&answer))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn image_attempts_exhausted_invalidates() {
        let config = test_config();
        let memory = CaptchaMemoryStore::new();
        let (id, _png) = issue_image_captcha(&None, &memory, &config)
            .await
            .expect("issue");
        let answer = {
            let map = memory.image.lock().unwrap();
            map.get(&id).unwrap().0.clone()
        };
        let wrong = if answer == "zzzzz" { "aaaaa" } else { "zzzzz" };
        for _ in 0..3 {
            assert!(
                verify_image(&None, &memory, &config, Some(&id), Some(wrong))
                    .await
                    .is_err()
            );
        }
        // 耗尽后即使给出正确答案也失败
        assert!(
            verify_image(&None, &memory, &config, Some(&id), Some(&answer))
                .await
                .is_err()
        );
    }

    #[test]
    fn leading_zeros_check() {
        assert!(has_enough_leading_zeros("0000abc", 4));
        assert!(!has_enough_leading_zeros("000abc", 4));
        assert!(has_enough_leading_zeros("000abc", 0));
    }
}
