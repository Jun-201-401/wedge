-- 기준 문서: docs/wedge_schema.sql
-- 목적: Discovery recommendation과 Run materialization 사이의 ScenarioAuthoring job 경계를 저장한다.

CREATE TABLE IF NOT EXISTS scenario_authoring_job (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    source_discovery_id     UUID NOT NULL REFERENCES site_discovery(id) ON DELETE CASCADE,
    correlation_id          VARCHAR(120),
    idempotency_key         VARCHAR(160),
    status                  VARCHAR(32) NOT NULL DEFAULT 'CREATED'
                                CHECK (status IN ('CREATED','QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED','EXPIRED')),
    input_jsonb             JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_policy_jsonb   JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_trace_jsonb    JSONB NOT NULL DEFAULT '[]'::jsonb,
    candidates_jsonb        JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_jsonb        JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance_jsonb        JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_jsonb           JSONB NOT NULL DEFAULT 'null'::jsonb,
    created_by              UUID REFERENCES user_account(id),
    confirmed_candidate_id  VARCHAR(120),
    confirmed_by            UUID REFERENCES user_account(id),
    confirmed_at            TIMESTAMPTZ,
    materialized_run_id     UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ,
    deleted_at              TIMESTAMPTZ,
    version                 BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scenario_authoring_project_created
    ON scenario_authoring_job(project_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scenario_authoring_discovery
    ON scenario_authoring_job(source_discovery_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scenario_authoring_status
    ON scenario_authoring_job(status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_scenario_authoring_project_creator_idempotency
    ON scenario_authoring_job(project_id, created_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
