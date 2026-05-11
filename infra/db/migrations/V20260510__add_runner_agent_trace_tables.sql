-- 기준 문서: docs/wedge_schema.sql
-- 목적: Runner Agent Runtime callback에서 들어오는 AgentEvent / AgentTrace를 DB에 보존한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS runner_agent_event (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    task_id             UUID NOT NULL,
    attempt_id          UUID NOT NULL,
    agent_event_id      VARCHAR(160) NOT NULL,
    step_index          INTEGER NOT NULL CHECK (step_index >= 0),
    event_type          VARCHAR(80) NOT NULL,
    payload_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, agent_event_id)
);

CREATE TABLE IF NOT EXISTS runner_agent_trace (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    trace_id            UUID NOT NULL,
    task_id             UUID,
    attempt_id          UUID,
    final_outcome       VARCHAR(120),
    trace_jsonb         JSONB NOT NULL,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, trace_id)
);

CREATE INDEX IF NOT EXISTS idx_runner_agent_event_run_time
    ON runner_agent_event(run_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_runner_agent_trace_run_created
    ON runner_agent_trace(run_id, created_at DESC);
