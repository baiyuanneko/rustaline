//! SMTP 密码使用独立域分离密钥与随机 nonce；密文编码版本可独立演进。
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use sha2::Sha256;

use crate::error::AppError;

fn cipher(jwt_secret: &str) -> Aes256Gcm {
    let mut hmac = <Hmac<Sha256> as Mac>::new_from_slice(jwt_secret.as_bytes())
        .expect("HMAC accepts any key length");
    hmac.update(b"rustaline-settings-v1");
    Aes256Gcm::new(&hmac.finalize().into_bytes())
}

pub(super) fn encrypt(password: &str, jwt_secret: &str) -> Result<String, AppError> {
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher(jwt_secret)
        .encrypt(Nonce::from_slice(&nonce), password.as_bytes())
        .map_err(|_| AppError::internal_msg("settings password encryption failed"))?;
    let mut encoded = nonce.to_vec();
    encoded.extend(encrypted);
    Ok(format!("v1:{}", STANDARD.encode(encoded)))
}

pub(super) fn decrypt(encoded: &str, jwt_secret: &str) -> Option<String> {
    let bytes = STANDARD.decode(encoded.strip_prefix("v1:")?).ok()?;
    if bytes.len() < 28 {
        return None;
    }
    let plaintext = cipher(jwt_secret)
        .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..])
        .ok()?;
    String::from_utf8(plaintext).ok()
}
