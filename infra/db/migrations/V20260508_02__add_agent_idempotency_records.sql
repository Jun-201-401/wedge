-- 기준 문서: docs/wedge_schema.sql
-- 목적: agent.execute terminal result를 API/DB에 저장해 여러 Runner replica가 idempotency 결과를 공유할 수 있게 한다.

CREATE TABLE IF NOT EXISTS agent_idempotency_record (
    idempotency_key_hash VARCHAR(64) PRIMARY KEY,
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    task_id             VARCHAR(160) NOT NULL,
    attempt_id          VARCHAR(160) NOT NULL,
    attempt_index       INTEGER NOT NULL CHECK (attempt_index >= 1),
    result_jsonb        JSONB NOT NULL,
    outcome_status      VARCHAR(32) NOT NULL,
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_idempotency_run
    ON agent_idempotency_record(run_id, completed_at DESC);
