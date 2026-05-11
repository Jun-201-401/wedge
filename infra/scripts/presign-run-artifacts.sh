#!/usr/bin/env bash
set -euo pipefail

RUN_ID="${1:-}"
if [[ -z "$RUN_ID" ]]; then
  echo "usage: bash infra/scripts/presign-run-artifacts.sh <runId>" >&2
  exit 2
fi

if [[ ! "$RUN_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "runId must be a UUID" >&2
  exit 2
fi

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
LIMIT="${PRESIGN_LIMIT:-20}"
EXPIRES_IN="${PRESIGN_EXPIRES_IN:-3600}"

if [[ ! "$LIMIT" =~ ^[0-9]+$ ]] || [[ "$LIMIT" -lt 1 ]] || [[ "$LIMIT" -gt 20 ]]; then
  echo "PRESIGN_LIMIT must be between 1 and 20" >&2
  exit 2
fi

if [[ ! "$EXPIRES_IN" =~ ^[0-9]+$ ]] || [[ "$EXPIRES_IN" -lt 60 ]]; then
  echo "PRESIGN_EXPIRES_IN must be at least 60 seconds" >&2
  exit 2
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command is required" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required on this server" >&2
  echo "install awscli or use the API endpoint /api/runs/{runId}/artifacts/presigned-urls" >&2
  exit 1
fi

AWS_REGION_VALUE="${WEDGE_ARTIFACT_S3_REGION:-${AWS_REGION:-ap-northeast-2}}"
S3_ENDPOINT_VALUE="${PRESIGN_ENDPOINT_URL:-${WEDGE_ARTIFACT_S3_ENDPOINT:-}}"
DB_USER="${SPRING_DATASOURCE_USERNAME:-${POSTGRES_USER:-wedge_app}}"
DB_PASSWORD="${SPRING_DATASOURCE_PASSWORD:-${POSTGRES_PASSWORD:-}}"
DB_NAME="${POSTGRES_DB:-}"

if [[ -z "$DB_NAME" && -n "${SPRING_DATASOURCE_URL:-}" ]]; then
  DB_NAME="${SPRING_DATASOURCE_URL##*/}"
  DB_NAME="${DB_NAME%%\?*}"
fi
DB_NAME="${DB_NAME:-wedge}"

SQL="
SELECT id, s3_bucket, s3_key, mime_type
FROM artifact
WHERE source_type = 'RUN'
  AND run_id = '$RUN_ID'
  AND lower(mime_type) IN ('image/png', 'image/jpeg', 'image/webp')
ORDER BY created_at DESC
LIMIT $LIMIT;
"

PSQL_ARGS=(
  compose
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
  exec
  -T
  "$POSTGRES_SERVICE"
  env
)

if [[ -n "$DB_PASSWORD" ]]; then
  PSQL_ARGS+=("PGPASSWORD=$DB_PASSWORD")
fi

PSQL_ARGS+=(
  psql
  -U "$DB_USER"
  -d "$DB_NAME"
  -At
  -F $'\t'
  -v ON_ERROR_STOP=1
  -c "$SQL"
)

rows="$(docker "${PSQL_ARGS[@]}")"

if [[ -z "$rows" ]]; then
  echo "No image artifacts found for runId: $RUN_ID" >&2
  exit 0
fi

while IFS=$'\t' read -r artifact_id bucket key mime_type; do
  [[ -z "$artifact_id" ]] && continue

  aws_args=(
    s3
    presign
    "s3://$bucket/$key"
    --expires-in "$EXPIRES_IN"
    --region "$AWS_REGION_VALUE"
  )

  if [[ -n "$S3_ENDPOINT_VALUE" ]]; then
    aws_args+=(--endpoint-url "$S3_ENDPOINT_VALUE")
  fi

  url="$(aws "${aws_args[@]}")"
  printf '%s\t%s\t%s\n' "$artifact_id" "$mime_type" "$url"
done <<< "$rows"
