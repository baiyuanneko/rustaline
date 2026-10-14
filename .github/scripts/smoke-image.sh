#!/usr/bin/env bash
set -euo pipefail

image=${1:?usage: smoke-image.sh IMAGE}
network=rustaline-smoke
redis_container=rustaline-smoke-redis
app_container=rustaline-smoke-app

cleanup() {
  docker rm -f "$app_container" "$redis_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$redis_container" --network "$network" redis:7 >/dev/null

admin_password=$(openssl rand -hex 16)
jwt_secret=$(openssl rand -hex 32)
docker run -d --name "$app_container" --network "$network" \
  -p 127.0.0.1:18080:8080 \
  -e APP_REDIS_URL="redis://$redis_container:6379" \
  -e APP_JWT_SECRET="$jwt_secret" \
  -e APP_INITIAL_ADMIN_USERNAME=admin \
  -e APP_INITIAL_ADMIN_PASSWORD="$admin_password" \
  -e APP_TRUST_XFF=false \
  -e APP_LOG_LEVEL=warn \
  "$image" >/dev/null

ready=false
for _ in {1..60}; do
  if health=$(curl --fail --silent http://127.0.0.1:18080/health); then
    if jq -e '.status == "ok" and .db == "up"' <<< "$health" >/dev/null; then
      ready=true
      break
    fi
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$app_container"
  exit 1
fi

curl --fail --silent http://127.0.0.1:18080/admin/ -o /dev/null
curl --fail --silent http://127.0.0.1:18080/sdk/rustaline.js -o /dev/null
curl --fail --silent http://127.0.0.1:18080/api/v1/captcha/config |
  jq -e '.pow.enabled and .image.enabled and .comment_max_length == 10000' >/dev/null
curl --fail --silent http://127.0.0.1:18080/api/v1/captcha/image |
  jq -e '.captcha_id != "" and (.image | startswith("data:image/png;base64,"))' >/dev/null
login_body=$(jq -n --arg password "$admin_password" '{username:"admin",password:$password}')
token=$(curl --fail --silent -H 'Content-Type: application/json' \
  --data "$login_body" http://127.0.0.1:18080/api/v1/auth/login | jq -er '.access_token')
curl --fail --silent -H "Authorization: Bearer $token" http://127.0.0.1:18080/api/v1/admin/config |
  jq -e '.revision == 1 and .mail.enabled == false' >/dev/null
docker exec "$app_container" test ! -e /app/config/local.toml
docker exec "$app_container" test ! -e /app/.env
echo "Container smoke test passed: $image"
