#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/compose.dev.yaml}"

if [ ! -f "$ENV_FILE" ]; then
    echo "로컬 env 파일을 찾을 수 없습니다: ${ENV_FILE}" >&2
    exit 1
fi

cd "$ROOT_DIR"

echo "host 개발 환경을 시작합니다."
echo "API는 IntelliJ, Web은 VSCode에서 실행하세요."

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d \
    postgres \
    redis \
    rabbitmq \
    minio \
    minio-init \
    runner \
    analyzer-api \
    analyzer-worker

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
