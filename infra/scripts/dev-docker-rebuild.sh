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

echo "Docker 개발 환경의 app 컨테이너를 최신화합니다."
echo "API, Web, Runner, Analyzer를 다시 빌드하고 재시작합니다."

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web build \
    api-server \
    web \
    runner \
    analyzer-worker \
    analyzer-api

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web up -d --force-recreate rabbitmq

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web up -d --force-recreate \
    api-server \
    web \
    runner \
    analyzer-worker \
    analyzer-api

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web ps \
    rabbitmq \
    api-server \
    web \
    runner \
    analyzer-worker \
    analyzer-api

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile api --profile web exec rabbitmq \
    rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
