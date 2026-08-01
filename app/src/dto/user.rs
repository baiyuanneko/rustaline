use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::entities::user;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserRequest {
    #[schema(example = "bob")]
    pub username: String,
    #[schema(example = "secret123", min_length = 6)]
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateUserRequest {
    #[schema(example = "bob2")]
    pub username: Option<String>,
    #[schema(example = "newsecret123", min_length = 6)]
    pub password: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserResponse {
    #[schema(example = 1)]
    pub id: i32,
    #[schema(example = "alice")]
    pub username: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl From<user::Model> for UserResponse {
    fn from(model: user::Model) -> Self {
        Self {
            id: model.id,
            username: model.username,
            created_at: model.created_at,
            updated_at: model.updated_at,
        }
    }
}
