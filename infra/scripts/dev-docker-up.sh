#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.docker}"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/compose.dev.yaml}"

if [ ! -f "$ENV_FILE" ]; then
    echo "Docker 전용 env 파일을 찾을 수 없습니다: ${ENV_FILE}" >&2
    exit 1
fi

cd "$ROOT_DIR"

echo "Docker 개발 환경을 시작합니다."
echo "API와 Web까지 Docker Compose로 실행합니다."

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web up -d \
    postgres \
    redis \
    rabbitmq \
    minio \
    minio-init \
    api-server \
    web \
    runner \
    analyzer-api \
    analyzer-worker

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web ps
