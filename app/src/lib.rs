//! bynrust26 应用库：所有模块都在这里，集成测试（tests/）与本crate 二进制共用。

pub mod auth;
pub mod config;
pub mod dto;
pub mod entities;
pub mod error;
pub mod handlers;
pub mod middleware;
pub mod openapi;
pub mod routes;
pub mod services;
pub mod state;
