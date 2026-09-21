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
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v1/captcha/config",
    tag = "captcha",
    responses(
        (status = 200, description = "Captcha switches and PoW difficulty", body = CaptchaConfigResponse),
    )
)]
#[debug_handler]
pub async fn get_captcha_config(State(state): State<AppState>) -> Json<CaptchaConfigResponse> {
    let c = &state.config.comment.captcha;
    Json(CaptchaConfigResponse {
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
        (status = 429, description = "Issue rate limit exceeded", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_pow_challenge(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
) -> Json<PowChallengeResponse> {
    let challenge = captcha_service::issue_pow_challenge(
        &state.captcha_signing_key,
        &state.config.comment.captcha,
        &ip,
    );
    Json(PowChallengeResponse {
        challenge,
        difficulty: state.config.comment.captcha.pow_difficulty,
        ttl: state.config.comment.captcha.pow_ttl_secs,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/captcha/image",
    tag = "captcha",
    responses(
        (status = 200, description = "Image captcha (id + PNG data uri)", body = ImageCaptchaResponse),
        (status = 429, description = "Issue rate limit exceeded", body = crate::dto::ErrorResponse),
    )
)]
#[debug_handler]
pub async fn get_image_captcha(
    State(state): State<AppState>,
) -> Result<Json<ImageCaptchaResponse>, AppError> {
    let (captcha_id, png) = captcha_service::issue_image_captcha(
        &state.redis,
        &state.captcha_memory,
        &state.config.comment.captcha,
    )
    .await?;
    let image = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    );
    Ok(Json(ImageCaptchaResponse {
        captcha_id,
        image,
        ttl: state.config.comment.captcha.image_ttl_secs,
    }))
}
