-- 기준 문서: docs/wedge_schema.sql
-- 목적: Discovery API와 Runner discovery callback 저장을 위한 기준 테이블을 현재 DB에 반영한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS site_discovery (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    input_url           TEXT NOT NULL,
    final_url           TEXT,
    device_preset       VARCHAR(32) NOT NULL CHECK (device_preset IN ('desktop', 'mobile', 'tablet')),
    viewport_jsonb      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status              VARCHAR(32) NOT NULL DEFAULT 'CREATED'
                            CHECK (status IN ('CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELED')),
    summary_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by          UUID REFERENCES user_account(id),
    idempotency_key     VARCHAR(160),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    failure_code        VARCHAR(80),
    failure_message     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    version             BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenario_recommendation (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_id         UUID NOT NULL REFERENCES site_discovery(id) ON DELETE CASCADE,
    scenario_type        VARCHAR(64) NOT NULL CHECK (scenario_type IN ('LANDING_CTA','SIGNUP_LEAD_FORM','PRICING','PURCHASE_CHECKOUT','CONTACT','CONTENT_ONLY','CUSTOM_GUIDED')),
    recommendation_level VARCHAR(32) NOT NULL CHECK (recommendation_level IN ('HIGH','MEDIUM','LOW','NOT_AVAILABLE')),
    confidence           NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reason               TEXT NOT NULL,
    evidence_refs_jsonb  JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggested_start_url  TEXT,
    suggested_target_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_discovery_project_created
    ON site_discovery(project_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_discovery_status
    ON site_discovery(status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scenario_recommendation_discovery_level
    ON scenario_recommendation(discovery_id, recommendation_level);


CREATE UNIQUE INDEX IF NOT EXISTS ux_site_discovery_project_creator_idempotency
    ON site_discovery(project_id, created_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
