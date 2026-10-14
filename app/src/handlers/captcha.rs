use axum::extract::State;
use axum::{Json, debug_handler};
use base64::Engine as _;

use crate::dto::{
    CaptchaConfigResponse, ImageCaptchaConfigInfo, ImageCaptchaResponse, PowChallengeResponse,
    PowConfigInfo,
};
use crate::error::AppError;
use crate::middleware::rate_limit::ClientIp;
use crate::services::captcha_service;
use crate::services::settings_service::RuntimeSettings;
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v1/captcha/config",
    tag = "captcha",
    responses(
        (status = 200, description = "Captcha switches and PoW difficulty", body = CaptchaConfigResponse),
    )
)]
#[debug_handler(state = AppState)]
pub async fn get_captcha_config(
    RuntimeSettings(settings): RuntimeSettings,
) -> Json<CaptchaConfigResponse> {
    let c = &settings.comment.captcha;
    Json(CaptchaConfigResponse {
        comment_max_length: settings.comment.max_length,
        reply_notification_enabled: settings.mail.enabled
            && settings.mail.notify_reply
            && !settings.password_needs_reset,
        pow: PowConfigInfo {
            enabled: c.pow_enabled,
            difficulty: c.pow_difficulty,
        },
        image: ImageCaptchaConfigInfo {
            enabled: c.image_enabled,
        },
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/captcha/pow",
    tag = "captcha",
    responses(
        (status = 200, description = "Signed PoW challenge", body = PowChallengeResponse),
        (status = 404, description = "PoW captcha disabled (pow_enabled = false)", body = crate::dto::ErrorResponse),
        (status = 429, description = "Issue rate limit exceeded", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_pow_challenge(
    State(state): State<AppState>,
    RuntimeSettings(settings): RuntimeSettings,
    ClientIp(ip): ClientIp,
) -> Result<Json<PowChallengeResponse>, AppError> {
    let captcha = &settings.comment.captcha;
    if !captcha.pow_enabled {
        // 开关关闭后不得继续签发（M-2）：签发端点 404，避免被当作免费的 HMAC 服务
        return Err(AppError::NotFound("pow captcha is disabled".into()));
    }
    let challenge = captcha_service::issue_pow_challenge(&state.captcha_signing_key, captcha, &ip);
    Ok(Json(PowChallengeResponse {
        challenge,
        difficulty: captcha.pow_difficulty,
        ttl: captcha.pow_ttl_secs,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/captcha/image",
    tag = "captcha",
    responses(
        (status = 200, description = "Image captcha (id + PNG data uri)", body = ImageCaptchaResponse),
        (status = 404, description = "Image captcha disabled (image_enabled = false)", body = crate::dto::ErrorResponse),
        (status = 429, description = "Issue rate limit exceeded", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_image_captcha(
    State(state): State<AppState>,
    RuntimeSettings(settings): RuntimeSettings,
) -> Result<Json<ImageCaptchaResponse>, AppError> {
    let captcha = &settings.comment.captcha;
    if !captcha.image_enabled {
        // 开关关闭后不得继续签发（M-2）：栅格化 + PNG 编码 + 写存储都有成本；
        // 也规避了 validate_captcha_config 对已关闭功能跳过 TTL 校验、
        // image_ttl_secs=0 时 SETEX 报错导致的 500
        return Err(AppError::NotFound("image captcha is disabled".into()));
    }
    let (captcha_id, png) =
        captcha_service::issue_image_captcha(&state.redis, &state.captcha_memory, captcha).await?;
    let image = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    );
    Ok(Json(ImageCaptchaResponse {
        captcha_id,
        image,
        ttl: captcha.image_ttl_secs,
    }))
}
