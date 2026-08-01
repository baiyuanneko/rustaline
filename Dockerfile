# syntax=docker/dockerfile:1

# ---------- builder ----------
# 注意：这是 Cargo workspace，必须 COPY 整个 workspace 再构建，不能只 COPY app/
FROM rust:1-slim AS builder
WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY app ./app
COPY migration ./migration

# 默认构建 sqlite 版。换数据库：
#   docker build --build-arg CARGO_FEATURES="--no-default-features --features postgres" .
ARG CARGO_FEATURES=""
RUN cargo build --release -p app ${CARGO_FEATURES}

# ---------- runtime ----------
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

WORKDIR /app
# 运行时需要 config/default.toml（config/local.toml 与 .env 可选）
COPY config ./config
COPY --from=builder /build/target/release/bynrust26 /usr/local/bin/bynrust26

# SQLite 数据目录（建议挂卷持久化）
RUN mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 8080
CMD ["bynrust26"]
