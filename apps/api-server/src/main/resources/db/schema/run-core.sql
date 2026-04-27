-- Run-domain bootstrap schema for the API server scaffold.
-- Source of truth remains docs/wedge_schema.sql; keep names and constraints aligned.
--
-- Assumptions:
-- - Baseline tables such as project, scenario_template_version, user_account,
--   evidence_packet, and rule_registry already exist before this script runs.
-- - This file is intentionally a focused Sprint 1 subset for run/analysis
--   persistence scaffolding, not the full product schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS test_run (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name                    VARCHAR(200) NOT NULL,
    trigger_source          VARCHAR(32) NOT NULL CHECK (trigger_source IN ('WEB', 'MCP', 'INTERNAL_AGENT', 'API')),
    start_url               TEXT NOT NULL,
    final_url               TEXT,
    goal                    TEXT,
    device_preset           VARCHAR(32) NOT NULL CHECK (device_preset IN ('desktop', 'mobile', 'tablet')),
    environment_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
    scenario_template_version_id UUID NOT NULL REFERENCES scenario_template_version(id),
    scenario_plan_schema_version VARCHAR(32),
    scenario_plan_jsonb     JSONB NOT NULL,

    status                  VARCHAR(32) NOT NULL DEFAULT 'CREATED'
                                CHECK (status IN ('CREATED','QUEUED','STARTING','RUNNING','STOP_REQUESTED','STOPPED','COMPLETED','FAILED')),
    result_completeness     VARCHAR(16) NOT NULL DEFAULT 'NONE'
                                CHECK (result_completeness IN ('NONE','PARTIAL','FINAL')),
    analysis_status         VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED'
                                CHECK (analysis_status IN ('NOT_STARTED','QUEUED','RUNNING','COMPLETED','FAILED')),

    current_step_order      INTEGER,
    worker_id               VARCHAR(128),
    latest_checkpoint_id    UUID,
    latest_artifact_id      UUID,
    latest_analysis_job_id  UUID,
    latest_report_id        UUID,
    friction_score          NUMERIC(5,2),

    stop_requested_at       TIMESTAMPTZ,
    started_at              TIMESTAMPTZ,
    execution_finished_at   TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    failure_code            VARCHAR(80),
    failure_message         TEXT,

    created_by              UUID REFERENCES user_account(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ,
    version                 BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_run_step (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_order              INTEGER NOT NULL,
    step_key                VARCHAR(120) NOT NULL,
    step_name               VARCHAR(200) NOT NULL,
    stage                   VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    step_type               VARCHAR(32) NOT NULL CHECK (step_type IN ('GOTO','CLICK','FILL','SELECT','SCROLL','HOVER','WAIT_FOR','CHECKPOINT','STOP_WHEN')),
    status                  VARCHAR(32) NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','SKIPPED','BLOCKED','STOPPED')),
    target_jsonb            JSONB,
    input_jsonb             JSONB,
    output_jsonb            JSONB,
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    error_code              VARCHAR(80),
    error_message           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                 BIGINT NOT NULL DEFAULT 0,
    UNIQUE (run_id, step_order),
    UNIQUE (run_id, step_key)
);

CREATE TABLE IF NOT EXISTS test_run_event (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_id                 UUID REFERENCES test_run_step(id) ON DELETE SET NULL,
    event_type              VARCHAR(64) NOT NULL,
    source                  VARCHAR(64) NOT NULL CHECK (source IN ('SPRING','RUNNER','ANALYZER','USER','MCP','SYSTEM')),
    payload_jsonb           JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifact (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type             VARCHAR(16) NOT NULL DEFAULT 'RUN' CHECK (source_type IN ('RUN','DISCOVERY')),
    run_id                  UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id            UUID,
    step_id                 UUID REFERENCES test_run_step(id) ON DELETE SET NULL,
    artifact_type           VARCHAR(32) NOT NULL CHECK (artifact_type IN ('FRAME','SCREENSHOT','DOM_SNAPSHOT','AX_TREE','TRACE','HAR','CONSOLE_LOG','REPORT_PDF','REPORT_MARKDOWN','REPORT_HTML','REPORT_JSON','OTHER')),
    s3_bucket               VARCHAR(160) NOT NULL,
    s3_key                  TEXT NOT NULL,
    public_url              TEXT,
    mime_type               VARCHAR(120) NOT NULL,
    width                   INTEGER,
    height                  INTEGER,
    size_bytes              BIGINT NOT NULL DEFAULT 0,
    sha256                  VARCHAR(64),
    captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (source_type = 'RUN' AND run_id IS NOT NULL)
        OR (source_type = 'DISCOVERY' AND discovery_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS checkpoint (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type             VARCHAR(16) NOT NULL DEFAULT 'RUN' CHECK (source_type IN ('RUN','DISCOVERY')),
    run_id                  UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id            UUID,
    step_id                 UUID REFERENCES test_run_step(id) ON DELETE SET NULL,
    checkpoint_key          VARCHAR(120) NOT NULL,
    stage                   VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    trigger_jsonb           JSONB NOT NULL,
    settle_jsonb            JSONB NOT NULL,
    state_jsonb             JSONB NOT NULL,
    delta_jsonb             JSONB NOT NULL DEFAULT '[]'::jsonb,
    artifact_refs_jsonb     JSONB NOT NULL DEFAULT '[]'::jsonb,
    captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms             INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (source_type = 'RUN' AND run_id IS NOT NULL)
        OR (source_type = 'DISCOVERY' AND discovery_id IS NOT NULL)
    ),
    UNIQUE (run_id, checkpoint_key),
    UNIQUE (discovery_id, checkpoint_key)
);

CREATE TABLE IF NOT EXISTS observation (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id           UUID NOT NULL REFERENCES checkpoint(id) ON DELETE CASCADE,
    run_id                  UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id            UUID,
    observation_key         VARCHAR(120) NOT NULL,
    observation_type        VARCHAR(64) NOT NULL,
    stage                   VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    sources_jsonb           JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_jsonb              JSONB NOT NULL,
    confidence              NUMERIC(4,3),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, observation_key),
    UNIQUE (discovery_id, observation_key)
);

CREATE TABLE IF NOT EXISTS analysis_job (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    job_type                VARCHAR(32) NOT NULL DEFAULT 'PRIMARY' CHECK (job_type IN ('PRIMARY','REPROCESS','COMPARE')),
    status                  VARCHAR(32) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
    evidence_packet_id      UUID REFERENCES evidence_packet(id),
    rule_registry_id        UUID REFERENCES rule_registry(id),
    judge_schema_version    VARCHAR(32),
    analyzer_version        VARCHAR(64),
    prompt_version          VARCHAR(64),
    model_info_jsonb        JSONB,
    output_jsonb            JSONB,
    friction_score          NUMERIC(5,2),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    error_code              VARCHAR(80),
    error_message           TEXT
);

CREATE TABLE IF NOT EXISTS outbox_message (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type      VARCHAR(80) NOT NULL,
    aggregate_id        UUID NOT NULL,
    event_type          VARCHAR(120) NOT NULL,
    payload_jsonb       JSONB NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed_message (
    consumer_name           VARCHAR(120) NOT NULL,
    message_id              VARCHAR(160) NOT NULL,
    processed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (consumer_name, message_id)
);

CREATE INDEX IF NOT EXISTS idx_test_run_project_created
    ON test_run(project_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_test_run_status
    ON test_run(status, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_test_run_analysis_status
    ON test_run(analysis_status, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_test_run_step_run_order
    ON test_run_step(run_id, step_order);

CREATE INDEX IF NOT EXISTS idx_analysis_job_run_created
    ON analysis_job(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_run_event_run_time
    ON test_run_event(run_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_run_created
    ON artifact(source_type, run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkpoint_run_captured
    ON checkpoint(source_type, run_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_observation_run_type
    ON observation(run_id, observation_type);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_message(status, next_attempt_at);
