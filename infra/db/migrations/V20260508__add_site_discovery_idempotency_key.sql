-- 목적: 기존 dev DB에 누락될 수 있는 site_discovery idempotency 컬럼을 보정한다.
-- 주의: V20260423 마이그레이션이 이미 적용된 DB는 같은 파일의 이후 수정분을 자동 반영하지 않으므로 별도 보정 migration으로 유지한다.

ALTER TABLE site_discovery
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS ux_site_discovery_project_creator_idempotency
    ON site_discovery(project_id, created_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
