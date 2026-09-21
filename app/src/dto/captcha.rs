use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 客户端提交的 PoW 解：只提交 challenge（服务端签发的签名令牌）与 nonce，
/// 哈希由服务端重算，客户端无法用伪造哈希蒙混。
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct PowSolution {
    /// 服务端 GET /api/v1/captcha/pow 下发的签名 challenge（不透明字符串）
    pub challenge: String,
    /// 使 SHA-256(challenge + ":" + nonce) 前 difficulty 个十六进制位为 0 的 nonce
    pub nonce: u64,
}

/// `GET /api/v1/captcha/config`：SDK 启动探测服务端验证码开关
#[derive(Debug, Serialize, ToSchema)]
pub struct CaptchaConfigResponse {
    pub pow: PowConfigInfo,
    pub image: ImageCaptchaConfigInfo,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PowConfigInfo {
    pub enabled: bool,
    /// 难度（哈希十六进制前导零位数），客户端据此求解
    pub difficulty: u32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImageCaptchaConfigInfo {
    pub enabled: bool,
}

/// `GET /api/v1/captcha/pow`
#[derive(Debug, Serialize, ToSchema)]
pub struct PowChallengeResponse {
    /// 签名 challenge 令牌；提交评论时原样回传
    pub challenge: String,
    pub difficulty: u32,
    /// 有效期（秒）
    pub ttl: u64,
}

/// `GET /api/v1/captcha/image`
#[derive(Debug, Serialize, ToSchema)]
pub struct ImageCaptchaResponse {
    /// 图形码 id；提交评论时与用户输入一并回传
    pub captcha_id: String,
    /// PNG 图片 data URI，可直接赋给 <img src>
    pub image: String,
    /// 有效期（秒）
    pub ttl: u64,
}
