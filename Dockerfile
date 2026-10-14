# syntax=docker/dockerfile:1

# ---------- builder ----------
# 注意：这是 Cargo workspace，必须 COPY 整个 workspace 再构建，不能只 COPY app/
# builder 与 runtime 必须钉死同一 Debian 代号（bookworm）：rust:1-slim 是浮动标签，
# 若其滚动到更新的发行版（glibc 更高）而 runtime 不跟进，编译出的二进制会在启动时
# 因 GLIBC_x.xx not found 崩溃，且构建期无任何告警
ARG DEBIAN_MIRROR=deb.debian.org
FROM rust:1-slim-bookworm AS builder
ARG DEBIAN_MIRROR

# 云端默认使用官方源；本地可通过 DEBIAN_MIRROR=mirrors.aliyun.com 换源。
# gcc 是必需的（sqlx-sqlite 会编译内嵌的 libsqlite3，需要 C 链接器）。
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends gcc curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 默认使用 crates.io；国内构建可以显式使用仓库的 Cargo 镜像配置。
COPY .cargo/config.toml /tmp/cargo-mirror.toml
ARG USE_CARGO_MIRROR=false
RUN if [ "$USE_CARGO_MIRROR" = "true" ]; then cp /tmp/cargo-mirror.toml /usr/local/cargo/config.toml; fi

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY app ./app
COPY migration ./migration

# 默认构建 sqlite 版。换数据库：
#   docker build --build-arg CARGO_FEATURES="--no-default-features --features postgres" .
ARG CARGO_FEATURES=""
RUN cargo build --locked --release -p app ${CARGO_FEATURES}

# ---------- runtime ----------
FROM debian:bookworm-slim
ARG DEBIAN_MIRROR

RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

WORKDIR /app
# 只将默认配置打进镜像；部署覆盖通过环境变量或挂载注入。
COPY config/default.toml ./config/default.toml
COPY static ./static
COPY --from=builder /build/target/release/bynrust26 /usr/local/bin/bynrust26

# SQLite 数据目录（建议挂卷持久化）
RUN mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 8080
CMD ["bynrust26"]
