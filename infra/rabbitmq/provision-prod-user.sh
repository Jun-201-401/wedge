#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"
ENV_FILE="${ENV_FILE:-.env.prod}"

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
