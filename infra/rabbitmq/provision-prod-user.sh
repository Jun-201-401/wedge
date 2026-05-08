#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"
ENV_FILE="${ENV_FILE:-.env.prod}"

wait_for_rabbitmq() {
  local attempts="${1:-60}"
  local delay_seconds="${2:-2}"
  local attempt

  for attempt in $(seq 1 "$attempts"); do
    if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T rabbitmq rabbitmqctl await_startup --timeout 5 >/dev/null 2>&1 \
      && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
      return 0
    fi

    echo "Waiting for RabbitMQ startup... (${attempt}/${attempts})"
    sleep "$delay_seconds"
  done

  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=100 rabbitmq
  return 1
}

wait_for_rabbitmq

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T rabbitmq sh -lc '
set -eu

: "${RABBITMQ_DEFAULT_USER:?RABBITMQ_DEFAULT_USER is required}"
: "${RABBITMQ_DEFAULT_PASS:?RABBITMQ_DEFAULT_PASS is required}"

if rabbitmqctl authenticate_user "$RABBITMQ_DEFAULT_USER" "$RABBITMQ_DEFAULT_PASS" >/dev/null 2>&1; then
  echo "RabbitMQ user credentials are already valid."
elif rabbitmqctl list_users -q | cut -f1 | grep -Fxq "$RABBITMQ_DEFAULT_USER"; then
  rabbitmqctl change_password "$RABBITMQ_DEFAULT_USER" "$RABBITMQ_DEFAULT_PASS"
else
  rabbitmqctl add_user "$RABBITMQ_DEFAULT_USER" "$RABBITMQ_DEFAULT_PASS"
fi

rabbitmqctl set_permissions -p / "$RABBITMQ_DEFAULT_USER" ".*" ".*" ".*"
rabbitmqctl set_user_tags "$RABBITMQ_DEFAULT_USER" administrator
rabbitmqctl authenticate_user "$RABBITMQ_DEFAULT_USER" "$RABBITMQ_DEFAULT_PASS" >/dev/null
'

echo "RabbitMQ production user and permissions are provisioned."
