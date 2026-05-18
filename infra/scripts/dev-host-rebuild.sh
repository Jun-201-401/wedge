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

echo "host 개발 환경의 Runner/Analyzer를 최신화합니다."
echo "API는 IntelliJ, Web은 VSCode에서 실행하는 기준입니다."

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build \
    runner \
    analyzer-worker \
    analyzer-api

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate rabbitmq

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate \
    runner \
    analyzer-worker \
    analyzer-api

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps \
    rabbitmq \
    runner \
    analyzer-worker \
    analyzer-api

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec rabbitmq \
    rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
