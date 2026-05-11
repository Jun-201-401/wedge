-- 기준 문서: docs/wedge_schema.sql
-- 목적: agent.execute terminal idempotency에 실행 전 CLAIMED lease를 추가해 다중 Runner replica의 동시 중복 실행을 줄인다.

ALTER TABLE agent_idempotency_record
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(128),
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

ALTER TABLE agent_idempotency_record
    ALTER COLUMN result_jsonb DROP NOT NULL,
    ALTER COLUMN outcome_status DROP NOT NULL,
    ALTER COLUMN completed_at DROP DEFAULT,
    ALTER COLUMN completed_at DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_agent_idempotency_status'
    ) THEN
        ALTER TABLE agent_idempotency_record
            ADD CONSTRAINT ck_agent_idempotency_status CHECK (status IN ('CLAIMED','COMPLETED'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_idempotency_lease
    ON agent_idempotency_record(status, lease_expires_at);
