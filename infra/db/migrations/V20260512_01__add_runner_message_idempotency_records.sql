-- 기준 문서: docs/wedge_schema.sql
-- 목적: run.execute/discovery.execute terminal result를 API/DB에 저장해 여러 Runner replica가 idempotency 결과를 공유할 수 있게 한다.

CREATE TABLE IF NOT EXISTS runner_message_idempotency_record (
    scope                VARCHAR(32) NOT NULL,
    idempotency_key_hash VARCHAR(64) NOT NULL,
    run_id               UUID NOT NULL,
    result_jsonb         JSONB NOT NULL,
    completed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_runner_message_idempotency PRIMARY KEY (scope, idempotency_key_hash),
    CONSTRAINT ck_runner_message_idempotency_scope CHECK (scope IN ('run','discovery'))
);

CREATE INDEX IF NOT EXISTS idx_runner_message_idempotency_run
    ON runner_message_idempotency_record(scope, run_id, completed_at DESC);
