#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.prod}"
RELEASE_ENV_FILE="${RELEASE_ENV_FILE:-${ROOT_DIR}/.deploy/current.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/compose.prod.yaml}"

if [ "${1:-}" = "--release-env" ]; then
    if [ -z "${2:-}" ]; then
        echo "Missing value for --release-env" >&2
        exit 2
    fi
    RELEASE_ENV_FILE="$2"
    shift 2
fi

if [ "$#" -eq 0 ]; then
    echo "Usage: bash infra/scripts/prod-compose.sh [--release-env FILE] <docker compose args...>" >&2
    exit 2
fi

case "$RELEASE_ENV_FILE" in
    /*) ;;
    *) RELEASE_ENV_FILE="${ROOT_DIR}/${RELEASE_ENV_FILE}" ;;
esac

if [ ! -f "$ENV_FILE" ]; then
    echo "Production env file not found: ${ENV_FILE}" >&2
    exit 1
fi

if [ ! -f "$RELEASE_ENV_FILE" ]; then
    echo "Release env file not found: ${RELEASE_ENV_FILE}" >&2
    echo "Run a successful Jenkins deployment first, or pass --release-env with a candidate release file." >&2
    exit 1
fi

for required_var in API_SERVER_IMAGE WEB_IMAGE RUNNER_IMAGE ANALYZER_IMAGE; do
    if ! grep -Eq "^${required_var}=.+" "$RELEASE_ENV_FILE"; then
        echo "Release env file is missing ${required_var}: ${RELEASE_ENV_FILE}" >&2
        exit 1
    fi
done

# shellcheck source=/dev/null
set -a
. "$RELEASE_ENV_FILE"
set +a

cd "$ROOT_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
