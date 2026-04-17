
-- Wedge V1 PostgreSQL DDL
-- Scope: Wedge domain schema only
-- Note: Spring Authorization Server OAuth/OIDC tables are intentionally excluded
--       and should be managed separately under the auth schema or a dedicated migration set.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. User / Workspace / Project
-- ---------------------------------------------------------------------------

CREATE TABLE user_account (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject        VARCHAR(200) NOT NULL UNIQUE,
    email               VARCHAR(320) NULL,
    display_name        VARCHAR(120) NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(200) NOT NULL,
    slug                VARCHAR(120) NOT NULL UNIQUE,
    created_by          UUID NULL REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_member (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    role                VARCHAR(32) NOT NULL
                            CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'INVITED', 'INACTIVE')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_member UNIQUE (workspace_id, user_id)
);

CREATE TABLE project (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name                VARCHAR(200) NOT NULL,
    key                 VARCHAR(64) NOT NULL,
    base_url            TEXT NOT NULL,
    description         TEXT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by          UUID NULL REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_workspace_key UNIQUE (workspace_id, key)
);

CREATE TABLE project_member (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    role                VARCHAR(32) NOT NULL
                            CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_member UNIQUE (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 2. Scenario Template
-- ---------------------------------------------------------------------------

CREATE TABLE scenario_template (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key        VARCHAR(100) NOT NULL UNIQUE,
    name                VARCHAR(200) NOT NULL,
    description         TEXT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEPRECATED')),
    created_by          UUID NULL REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scenario_template_version (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID NOT NULL REFERENCES scenario_template(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    definition_jsonb    JSONB NOT NULL,
    notes               TEXT NULL,
    created_by          UUID NULL REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_template_version UNIQUE (template_id, version)
);

-- ---------------------------------------------------------------------------
-- 3. Run / Step / Event
-- ---------------------------------------------------------------------------

CREATE TABLE test_run (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id                  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name                        VARCHAR(200) NOT NULL,
    trigger_source              VARCHAR(32) NOT NULL
                                    CHECK (trigger_source IN ('UI', 'MCP', 'INTERNAL_AGENT', 'SYSTEM')),
    start_url                   TEXT NOT NULL,
    goal                        TEXT NULL,
    device_preset               VARCHAR(32) NOT NULL
                                    CHECK (device_preset IN ('DESKTOP', 'TABLET', 'MOBILE')),
    scenario_template_version_id UUID NULL REFERENCES scenario_template_version(id),
    scenario_snapshot_jsonb     JSONB NOT NULL,

    status                      VARCHAR(32) NOT NULL
                                    CHECK (status IN (
                                        'CREATED',
                                        'QUEUED',
                                        'STARTING',
                                        'RUNNING',
                                        'STOP_REQUESTED',
                                        'STOPPED',
                                        'ANALYZING',
                                        'COMPLETED',
                                        'FAILED'
                                    )),
    result_completeness         VARCHAR(16) NOT NULL DEFAULT 'NONE'
                                    CHECK (result_completeness IN ('NONE', 'PARTIAL', 'FINAL')),
    analysis_status             VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED'
                                    CHECK (analysis_status IN ('NOT_STARTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),

    current_step_order          INTEGER NULL,
    worker_id                   VARCHAR(128) NULL,

    started_at                  TIMESTAMPTZ NULL,
    execution_finished_at       TIMESTAMPTZ NULL,
    finished_at                 TIMESTAMPTZ NULL,
    stop_requested_at           TIMESTAMPTZ NULL,

    failure_code                VARCHAR(64) NULL,
    failure_message             TEXT NULL,

    created_by                  UUID NULL REFERENCES user_account(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE test_run_step (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_order          INTEGER NOT NULL,
    step_key            VARCHAR(100) NOT NULL,
    step_name           VARCHAR(200) NOT NULL,
    step_type           VARCHAR(32) NOT NULL
                            CHECK (step_type IN ('NAVIGATE', 'CLICK', 'INPUT', 'WAIT', 'ASSERT', 'EXTRACT', 'CUSTOM')),
    status              VARCHAR(32) NOT NULL
                            CHECK (status IN ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'BLOCKED', 'STOPPED')),
    target_jsonb        JSONB NULL,
    input_jsonb         JSONB NULL,
    output_jsonb        JSONB NULL,
    started_at          TIMESTAMPTZ NULL,
    finished_at         TIMESTAMPTZ NULL,
    error_code          VARCHAR(64) NULL,
    error_message       TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_test_run_step UNIQUE (run_id, step_order)
);

CREATE TABLE test_run_event (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_id             UUID NULL REFERENCES test_run_step(id) ON DELETE SET NULL,
    event_type          VARCHAR(64) NOT NULL,
    source              VARCHAR(32) NOT NULL
                            CHECK (source IN ('SPRING', 'RUNNER', 'ANALYZER', 'SYSTEM')),
    payload_jsonb       JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Artifact / Snapshot / Signal
-- ---------------------------------------------------------------------------

CREATE TABLE artifact (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_id             UUID NULL REFERENCES test_run_step(id) ON DELETE SET NULL,
    artifact_type       VARCHAR(32) NOT NULL
                            CHECK (artifact_type IN ('FRAME', 'SCREENSHOT', 'DOM', 'TRACE', 'NETWORK_DUMP', 'REPORT_PDF', 'REPORT_MD')),
    s3_bucket           VARCHAR(100) NOT NULL,
    s3_key              TEXT NOT NULL,
    mime_type           VARCHAR(100) NOT NULL,
    width               INTEGER NULL,
    height              INTEGER NULL,
    size_bytes          BIGINT NOT NULL,
    sha256              VARCHAR(64) NULL,
    captured_at         TIMESTAMPTZ NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE page_snapshot (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                      UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_id                     UUID NULL REFERENCES test_run_step(id) ON DELETE SET NULL,
    artifact_id                 UUID NULL REFERENCES artifact(id) ON DELETE SET NULL,
    url                         TEXT NOT NULL,
    title                       TEXT NULL,
    dom_summary_jsonb           JSONB NOT NULL DEFAULT '{}'::JSONB,
    cta_candidates_jsonb        JSONB NOT NULL DEFAULT '[]'::JSONB,
    form_summary_jsonb          JSONB NOT NULL DEFAULT '{}'::JSONB,
    trust_signal_summary_jsonb  JSONB NOT NULL DEFAULT '{}'::JSONB,
    visual_competition_jsonb    JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE issue_signal (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_id             UUID NULL REFERENCES test_run_step(id) ON DELETE SET NULL,
    snapshot_id         UUID NULL REFERENCES page_snapshot(id) ON DELETE SET NULL,
    category            VARCHAR(64) NOT NULL
                            CHECK (category IN (
                                'CTA_VISIBILITY',
                                'CTA_CLARITY',
                                'TRUST_LACK',
                                'INPUT_FRICTION',
                                'PROGRESS_UNCLEAR',
                                'ERROR_RECOVERY_WEAK',
                                'FLOW_BREAK',
                                'VISUAL_COMPETITION'
                            )),
    source              VARCHAR(32) NOT NULL
                            CHECK (source IN ('RULE_ENGINE', 'DEEPGAZE', 'FUXI_CTR', 'LLM_ANALYZER', 'SYSTEM')),
    score               NUMERIC(8,4) NULL,
    confidence          NUMERIC(8,4) NULL,
    reason              TEXT NOT NULL,
    evidence_refs_jsonb JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. Analysis / Nudge / Report
-- ---------------------------------------------------------------------------

CREATE TABLE analysis_job (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    analysis_type       VARCHAR(32) NOT NULL
                            CHECK (analysis_type IN ('PRIMARY', 'REPROCESS', 'COMPARE')),
    status              VARCHAR(32) NOT NULL
                            CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
    analyzer_version    VARCHAR(64) NULL,
    prompt_version      VARCHAR(64) NULL,
    model_info_jsonb    JSONB NULL,
    output_jsonb        JSONB NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ NULL,
    finished_at         TIMESTAMPTZ NULL,
    error_code          VARCHAR(64) NULL,
    error_message       TEXT NULL
);

CREATE TABLE analysis_finding (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_job_id     UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
    rank_no             INTEGER NOT NULL,
    category            VARCHAR(64) NOT NULL,
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    confidence          NUMERIC(8,4) NULL,
    impact              VARCHAR(32) NULL
                            CHECK (impact IS NULL OR impact IN ('LOW', 'MEDIUM', 'HIGH')),
    related_step_ids_jsonb JSONB NOT NULL DEFAULT '[]'::JSONB,
    evidence_refs_jsonb JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE nudge (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_job_id     UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
    finding_id          UUID NULL REFERENCES analysis_finding(id) ON DELETE SET NULL,
    rank_no             INTEGER NOT NULL,
    title               VARCHAR(200) NOT NULL,
    rationale           TEXT NOT NULL,
    difficulty          VARCHAR(32) NULL
                            CHECK (difficulty IS NULL OR difficulty IN ('LOW', 'MEDIUM', 'HIGH')),
    expected_effect     VARCHAR(32) NULL
                            CHECK (expected_effect IS NULL OR expected_effect IN ('LOW', 'MEDIUM', 'HIGH')),
    follow_up_question  TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE report (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    analysis_job_id     UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
    format              VARCHAR(16) NOT NULL
                            CHECK (format IN ('PDF', 'MARKDOWN', 'LINK')),
    status              VARCHAR(32) NOT NULL
                            CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
    artifact_id         UUID NULL REFERENCES artifact(id) ON DELETE SET NULL,
    share_token         VARCHAR(128) NULL,
    created_by          UUID NULL REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ NULL,
    error_code          VARCHAR(64) NULL,
    error_message       TEXT NULL,
    CONSTRAINT uq_report_unique UNIQUE (run_id, analysis_job_id, format)
);

-- ---------------------------------------------------------------------------
-- 6. Agent / Audit / Reliability
-- ---------------------------------------------------------------------------

CREATE TABLE agent_client_policy (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oauth_client_id         VARCHAR(200) NOT NULL UNIQUE,
    client_type             VARCHAR(32) NOT NULL
                                CHECK (client_type IN ('INTERNAL_AGENT', 'CLAUDE_CODE', 'CODEX', 'SERVICE_ACCOUNT')),
    tool_allowlist_jsonb    JSONB NOT NULL DEFAULT '[]'::JSONB,
    approval_policy_jsonb   JSONB NOT NULL DEFAULT '{}'::JSONB,
    default_project_id      UUID NULL REFERENCES project(id) ON DELETE SET NULL,
    active                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcp_invocation_log (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oauth_client_id         VARCHAR(200) NOT NULL,
    tool_name               VARCHAR(200) NOT NULL,
    project_id              UUID NULL REFERENCES project(id) ON DELETE SET NULL,
    run_id                  UUID NULL REFERENCES test_run(id) ON DELETE SET NULL,
    request_summary_jsonb   JSONB NOT NULL DEFAULT '{}'::JSONB,
    response_summary_jsonb  JSONB NOT NULL DEFAULT '{}'::JSONB,
    status                  VARCHAR(32) NOT NULL
                                CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED', 'REJECTED')),
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at             TIMESTAMPTZ NULL
);

CREATE TABLE outbox_message (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type      VARCHAR(64) NOT NULL,
    aggregate_id        UUID NOT NULL,
    event_type          VARCHAR(128) NOT NULL,
    payload_jsonb       JSONB NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMPTZ NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at        TIMESTAMPTZ NULL
);

CREATE TABLE processed_message (
    consumer_name       VARCHAR(100) NOT NULL,
    message_id          VARCHAR(200) NOT NULL,
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (consumer_name, message_id)
);

-- ---------------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_workspace_member_workspace_id ON workspace_member (workspace_id);
CREATE INDEX idx_workspace_member_user_id ON workspace_member (user_id);

CREATE INDEX idx_project_workspace_id ON project (workspace_id);
CREATE INDEX idx_project_member_project_id ON project_member (project_id);
CREATE INDEX idx_project_member_user_id ON project_member (user_id);

CREATE INDEX idx_test_run_project_created_at ON test_run (project_id, created_at DESC);
CREATE INDEX idx_test_run_status_updated_at ON test_run (status, updated_at DESC);
CREATE INDEX idx_test_run_analysis_status_updated_at ON test_run (analysis_status, updated_at DESC);
CREATE INDEX idx_test_run_created_by ON test_run (created_by);

CREATE INDEX idx_test_run_step_run_id_step_order ON test_run_step (run_id, step_order);
CREATE INDEX idx_test_run_step_status ON test_run_step (status);

CREATE INDEX idx_test_run_event_run_occurred_at ON test_run_event (run_id, occurred_at DESC);
CREATE INDEX idx_test_run_event_step_id ON test_run_event (step_id);

CREATE INDEX idx_artifact_run_created_at ON artifact (run_id, created_at DESC);
CREATE INDEX idx_artifact_step_id ON artifact (step_id);
CREATE INDEX idx_artifact_type ON artifact (artifact_type);

CREATE INDEX idx_page_snapshot_run_id ON page_snapshot (run_id);
CREATE INDEX idx_page_snapshot_step_id ON page_snapshot (step_id);

CREATE INDEX idx_issue_signal_run_category_conf ON issue_signal (run_id, category, confidence DESC);
CREATE INDEX idx_issue_signal_step_id ON issue_signal (step_id);

CREATE INDEX idx_analysis_job_run_created_at ON analysis_job (run_id, created_at DESC);
CREATE INDEX idx_analysis_job_status ON analysis_job (status);

CREATE INDEX idx_analysis_finding_job_rank ON analysis_finding (analysis_job_id, rank_no);
CREATE INDEX idx_nudge_job_rank ON nudge (analysis_job_id, rank_no);

CREATE INDEX idx_report_run_created_at ON report (run_id, created_at DESC);
CREATE INDEX idx_report_status ON report (status);

CREATE INDEX idx_mcp_invocation_oauth_started_at ON mcp_invocation_log (oauth_client_id, started_at DESC);
CREATE INDEX idx_outbox_status_next_attempt ON outbox_message (status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- End of schema
-- ---------------------------------------------------------------------------
