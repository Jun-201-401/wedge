-- 변경 대상: test_run(run creation aggregate)
-- 변경 내용: Idempotency-Key replay를 위한 key/hash 컬럼과 사용자 범위 unique index 추가
-- 이유: POST /api/runs가 Idempotency-Key를 받지만 기존에는 생성 요청 중복을 막지 못했다.
ALTER TABLE test_run
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
    ADD COLUMN IF NOT EXISTS idempotency_request_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS ux_test_run_project_creator_idempotency
    ON test_run(project_id, created_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
