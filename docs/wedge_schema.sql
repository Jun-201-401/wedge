-- Wedge V1 PostgreSQL DDL
-- Scope: Wedge canonical DB schema.
-- Spring Authorization Server OAuth/OIDC tables should be managed separately.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. User / Workspace / Project
-- ---------------------------------------------------------------------------

CREATE TABLE user_account (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject        VARCHAR(200) NOT NULL UNIQUE,
    email               VARCHAR(320),
    display_name        VARCHAR(120) NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE user_credential (
    user_id             UUID PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    password_hash       TEXT NOT NULL,
    password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(200) NOT NULL,
    slug                VARCHAR(120) NOT NULL UNIQUE,
    created_by          UUID REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    version             BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE workspace_member (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    role                VARCHAR(32) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'INACTIVE')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, user_id)
);

CREATE TABLE project (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name                VARCHAR(200) NOT NULL,
    project_key         VARCHAR(64) NOT NULL,
    base_url            TEXT NOT NULL,
    description         TEXT,
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by          UUID REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    version             BIGINT NOT NULL DEFAULT 0,
    UNIQUE (workspace_id, project_key)
);

CREATE TABLE project_member (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    role                VARCHAR(32) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 2. Scenario and Rules
-- ---------------------------------------------------------------------------

CREATE TABLE scenario_template (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key        VARCHAR(100) NOT NULL UNIQUE,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    category            VARCHAR(64),
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scenario_template_version (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID NOT NULL REFERENCES scenario_template(id) ON DELETE CASCADE,
    version_label       VARCHAR(50) NOT NULL,
    scenario_schema_version VARCHAR(32) NOT NULL,
    definition_jsonb    JSONB NOT NULL,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (template_id, version_label)
);

CREATE TABLE rule_registry (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registry_id         VARCHAR(120) NOT NULL UNIQUE,
    schema_version      VARCHAR(32) NOT NULL,
    description         TEXT,
    registry_jsonb      JSONB NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Site Discovery / Run / Step
-- ---------------------------------------------------------------------------

CREATE TABLE site_discovery (
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
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    failure_code        VARCHAR(80),
    failure_message     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    version             BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE scenario_recommendation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_id        UUID NOT NULL REFERENCES site_discovery(id) ON DELETE CASCADE,
    scenario_type       VARCHAR(64) NOT NULL CHECK (scenario_type IN ('LANDING_CTA','SIGNUP_LEAD_FORM','PRICING','PURCHASE_CHECKOUT','CONTACT','CONTENT_ONLY','CUSTOM_GUIDED')),
    recommendation_level VARCHAR(32) NOT NULL CHECK (recommendation_level IN ('HIGH','MEDIUM','LOW','NOT_AVAILABLE')),
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reason              TEXT NOT NULL,
    evidence_refs_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggested_start_url TEXT,
    suggested_target_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE test_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name                VARCHAR(200) NOT NULL,
    trigger_source      VARCHAR(32) NOT NULL CHECK (trigger_source IN ('WEB', 'MCP', 'INTERNAL_AGENT', 'API')),
    start_url           TEXT NOT NULL,
    final_url           TEXT,
    goal                TEXT,
    device_preset       VARCHAR(32) NOT NULL CHECK (device_preset IN ('desktop', 'mobile', 'tablet')),
    environment_jsonb   JSONB NOT NULL DEFAULT '{}'::jsonb,
    scenario_template_version_id UUID NOT NULL REFERENCES scenario_template_version(id),
    source_discovery_id UUID REFERENCES site_discovery(id) ON DELETE SET NULL,
    scenario_plan_schema_version VARCHAR(32),
    scenario_plan_jsonb JSONB NOT NULL,
    scenario_fit_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN'
                            CHECK (scenario_fit_status IN ('UNKNOWN','APPLICABLE','LOW_CONFIDENCE','NOT_APPLICABLE','BLOCKED_BY_SITE','UNSAFE_OR_RESTRICTED')),
    scenario_fit_reason TEXT,
    scenario_fit_summary_jsonb JSONB,

    status              VARCHAR(32) NOT NULL DEFAULT 'CREATED'
                            CHECK (status IN ('CREATED','QUEUED','STARTING','RUNNING','STOP_REQUESTED','STOPPED','COMPLETED','FAILED')),
    result_completeness VARCHAR(16) NOT NULL DEFAULT 'NONE'
                            CHECK (result_completeness IN ('NONE','PARTIAL','FINAL')),
    analysis_status     VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED'
                            CHECK (analysis_status IN ('NOT_STARTED','QUEUED','RUNNING','COMPLETED','FAILED')),

    current_step_order  INTEGER,
    worker_id           VARCHAR(128),
    latest_checkpoint_id UUID,
    latest_artifact_id  UUID,
    latest_analysis_job_id UUID,
    latest_report_id    UUID,
    friction_score      NUMERIC(5,2),

    stop_requested_at   TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    execution_finished_at TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    failure_code        VARCHAR(80),
    failure_message     TEXT,

    created_by          UUID REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    version             BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE test_run_step (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_order          INTEGER NOT NULL,
    step_key            VARCHAR(120) NOT NULL,
    step_name           VARCHAR(200) NOT NULL,
    stage               VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    step_type           VARCHAR(32) NOT NULL CHECK (step_type IN ('GOTO','CLICK','FILL','SELECT','SCROLL','HOVER','WAIT_FOR','CHECKPOINT','STOP_WHEN')),
    status              VARCHAR(32) NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','SKIPPED','BLOCKED','STOPPED')),
    target_jsonb        JSONB,
    input_jsonb         JSONB,
    output_jsonb        JSONB,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    error_code          VARCHAR(80),
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, step_order),
    UNIQUE (run_id, step_key)
);

-- Generic run event log for UI timeline, audit, and WebSocket replay.
CREATE TABLE test_run_event (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    step_id             UUID REFERENCES test_run_step(id) ON DELETE SET NULL,
    event_type          VARCHAR(64) NOT NULL,
    source              VARCHAR(64) NOT NULL CHECK (source IN ('SPRING','RUNNER','ANALYZER','USER','MCP','SYSTEM')),
    payload_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Evidence Storage
-- ---------------------------------------------------------------------------

CREATE TABLE artifact (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type         VARCHAR(16) NOT NULL DEFAULT 'RUN' CHECK (source_type IN ('RUN','DISCOVERY')),
    run_id              UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id        UUID REFERENCES site_discovery(id) ON DELETE CASCADE,
    step_id             UUID REFERENCES test_run_step(id) ON DELETE SET NULL,
    artifact_type       VARCHAR(32) NOT NULL CHECK (artifact_type IN ('FRAME','SCREENSHOT','DOM_SNAPSHOT','AX_TREE','TRACE','HAR','CONSOLE_LOG','REPORT_PDF','REPORT_MARKDOWN','REPORT_HTML','REPORT_JSON','OTHER')),
    s3_bucket           VARCHAR(160) NOT NULL,
    s3_key              TEXT NOT NULL,
    public_url          TEXT,
    mime_type           VARCHAR(120) NOT NULL,
    width               INTEGER,
    height              INTEGER,
    size_bytes          BIGINT NOT NULL DEFAULT 0,
    sha256              VARCHAR(64),
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (source_type = 'RUN' AND run_id IS NOT NULL)
        OR (source_type = 'DISCOVERY' AND discovery_id IS NOT NULL)
    )
);

CREATE TABLE checkpoint (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type         VARCHAR(16) NOT NULL DEFAULT 'RUN' CHECK (source_type IN ('RUN','DISCOVERY')),
    run_id              UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id        UUID REFERENCES site_discovery(id) ON DELETE CASCADE,
    step_id             UUID REFERENCES test_run_step(id) ON DELETE SET NULL,
    checkpoint_key      VARCHAR(120) NOT NULL,
    stage               VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    trigger_jsonb       JSONB NOT NULL,
    settle_jsonb        JSONB NOT NULL,
    state_jsonb         JSONB NOT NULL,
    delta_jsonb         JSONB NOT NULL DEFAULT '[]'::jsonb,
    artifact_refs_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms         INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (source_type = 'RUN' AND run_id IS NOT NULL)
        OR (source_type = 'DISCOVERY' AND discovery_id IS NOT NULL)
    ),
    UNIQUE (run_id, checkpoint_key),
    UNIQUE (discovery_id, checkpoint_key)
);

CREATE TABLE observation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id       UUID NOT NULL REFERENCES checkpoint(id) ON DELETE CASCADE,
    run_id              UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id        UUID REFERENCES site_discovery(id) ON DELETE CASCADE,
    observation_key     VARCHAR(120) NOT NULL,
    observation_type    VARCHAR(64) NOT NULL,
    stage               VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    sources_jsonb       JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_jsonb          JSONB NOT NULL,
    confidence          NUMERIC(4,3),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, observation_key),
    UNIQUE (discovery_id, observation_key)
);

CREATE TABLE evidence_packet (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_type      VARCHAR(16) NOT NULL DEFAULT 'RUN' CHECK (execution_type IN ('RUN','DISCOVERY')),
    run_id              UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id        UUID REFERENCES site_discovery(id) ON DELETE CASCADE,
    schema_version      VARCHAR(32) NOT NULL,
    packet_jsonb        JSONB NOT NULL,
    checkpoint_count    INTEGER NOT NULL DEFAULT 0,
    observation_count   INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (execution_type = 'RUN' AND run_id IS NOT NULL)
        OR (execution_type = 'DISCOVERY' AND discovery_id IS NOT NULL)
    ),
    UNIQUE (run_id, schema_version),
    UNIQUE (discovery_id, schema_version)
);

-- ---------------------------------------------------------------------------
-- 5. Analysis / Report
-- ---------------------------------------------------------------------------

CREATE TABLE analysis_job (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    job_type            VARCHAR(32) NOT NULL DEFAULT 'PRIMARY' CHECK (job_type IN ('PRIMARY','REPROCESS','COMPARE')),
    status              VARCHAR(32) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
    evidence_packet_id  UUID REFERENCES evidence_packet(id),
    rule_registry_id    UUID REFERENCES rule_registry(id),
    judge_schema_version VARCHAR(32),
    analyzer_version    VARCHAR(64),
    prompt_version      VARCHAR(64),
    model_info_jsonb    JSONB,
    output_jsonb        JSONB,
    friction_score      NUMERIC(5,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    error_code          VARCHAR(80),
    error_message       TEXT
);

CREATE TABLE rule_hit (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_job_id     UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    criterion_id        VARCHAR(120) NOT NULL,
    stage               VARCHAR(32) CHECK (stage IN ('FIRST_VIEW','VALUE','CTA','INPUT','COMMIT')),
    axis                VARCHAR(32) NOT NULL,
    severity            INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 3),
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    priority_score      NUMERIC(8,3) NOT NULL,
    evidence_level      VARCHAR(64),
    evidence_refs_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
    observations_jsonb  JSONB NOT NULL DEFAULT '[]'::jsonb,
    signals_jsonb       JSONB NOT NULL DEFAULT '[]'::jsonb,
    exceptions_jsonb    JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analysis_finding (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_job_id     UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    rank_order          INTEGER NOT NULL,
    title               VARCHAR(240) NOT NULL,
    summary             TEXT NOT NULL,
    category            VARCHAR(80) NOT NULL,
    stage               VARCHAR(32),
    axis                VARCHAR(32),
    severity            INTEGER CHECK (severity BETWEEN 0 AND 3),
    confidence          NUMERIC(4,3),
    priority_score      NUMERIC(8,3),
    impact_hypothesis   TEXT,
    evidence_refs_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (analysis_job_id, rank_order)
);

CREATE TABLE nudge (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_job_id     UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
    finding_id          UUID REFERENCES analysis_finding(id) ON DELETE CASCADE,
    rank_order          INTEGER NOT NULL,
    title               VARCHAR(240) NOT NULL,
    rationale           TEXT NOT NULL,
    recommendation      TEXT NOT NULL,
    difficulty          VARCHAR(32) CHECK (difficulty IN ('LOW','MEDIUM','HIGH')),
    expected_effect     TEXT,
    validation_question TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE report (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    analysis_job_id     UUID REFERENCES analysis_job(id),
    title               VARCHAR(240) NOT NULL,
    format              VARCHAR(32) NOT NULL DEFAULT 'MARKDOWN' CHECK (format IN ('PDF','MARKDOWN','HTML','JSON')),
    status              VARCHAR(32) NOT NULL DEFAULT 'READY' CHECK (status IN ('GENERATING','READY','FAILED','ARCHIVED')),
    summary_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision_map_jsonb  JSONB NOT NULL DEFAULT '[]'::jsonb,
    artifact_id         UUID REFERENCES artifact(id),
    created_by          UUID REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    version             BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE report_share (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id           UUID NOT NULL REFERENCES report(id) ON DELETE CASCADE,
    share_token         VARCHAR(160) NOT NULL UNIQUE,
    access_level        VARCHAR(32) NOT NULL DEFAULT 'VIEW' CHECK (access_level IN ('VIEW')),
    expires_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES user_account(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 6. Agent / MCP / Reliability
-- ---------------------------------------------------------------------------

CREATE TABLE agent_client_policy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oauth_client_id     VARCHAR(200) NOT NULL UNIQUE,
    client_type         VARCHAR(64) NOT NULL CHECK (client_type IN ('INTERNAL_LLM','CLAUDE_CODE','CODEX','SERVICE_ACCOUNT','OTHER')),
    display_name        VARCHAR(200) NOT NULL,
    tool_allowlist_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
    approval_policy_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_project_id  UUID REFERENCES project(id),
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcp_invocation_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oauth_client_id     VARCHAR(200),
    user_id             UUID REFERENCES user_account(id),
    project_id          UUID REFERENCES project(id),
    tool_name           VARCHAR(120) NOT NULL,
    request_summary_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_summary_jsonb JSONB,
    status              VARCHAR(32) NOT NULL CHECK (status IN ('STARTED','SUCCEEDED','FAILED','DENIED')),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    error_code          VARCHAR(80),
    error_message       TEXT
);

CREATE TABLE outbox_message (
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

CREATE TABLE processed_message (
    consumer_name       VARCHAR(120) NOT NULL,
    message_id          VARCHAR(160) NOT NULL,
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (consumer_name, message_id)
);

CREATE TABLE worker_instance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id           VARCHAR(128) NOT NULL UNIQUE,
    worker_type         VARCHAR(32) NOT NULL CHECK (worker_type IN ('RUNNER','ANALYZER','EXPORTER')),
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DRAINING','OFFLINE')),
    last_heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata_jsonb      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_workspace_member_user ON workspace_member(user_id);
CREATE INDEX idx_project_workspace ON project(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_project_member_user ON project_member(user_id);

CREATE INDEX idx_site_discovery_project_created ON site_discovery(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_site_discovery_status ON site_discovery(status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_scenario_recommendation_discovery_level ON scenario_recommendation(discovery_id, recommendation_level);
CREATE INDEX idx_test_run_source_discovery ON test_run(source_discovery_id) WHERE source_discovery_id IS NOT NULL;
CREATE INDEX idx_test_run_scenario_fit ON test_run(scenario_fit_status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_checkpoint_discovery_captured ON checkpoint(source_type, discovery_id, captured_at);
CREATE INDEX idx_observation_discovery_type ON observation(discovery_id, observation_type);
CREATE INDEX idx_artifact_discovery_created ON artifact(source_type, discovery_id, created_at);

CREATE INDEX idx_test_run_project_created ON test_run(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_test_run_status ON test_run(status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_test_run_analysis_status ON test_run(analysis_status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX idx_test_run_step_run_order ON test_run_step(run_id, step_order);
CREATE INDEX idx_checkpoint_run_captured ON checkpoint(source_type, run_id, captured_at);
CREATE INDEX idx_observation_run_type ON observation(run_id, observation_type);
CREATE INDEX idx_artifact_run_created ON artifact(source_type, run_id, created_at);

CREATE INDEX idx_analysis_job_run_created ON analysis_job(run_id, created_at DESC);
CREATE INDEX idx_rule_hit_run_priority ON rule_hit(run_id, priority_score DESC);
CREATE INDEX idx_finding_run_rank ON analysis_finding(run_id, rank_order);
CREATE INDEX idx_report_run_created ON report(run_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX idx_mcp_invocation_started ON mcp_invocation_log(started_at DESC);
CREATE INDEX idx_outbox_pending ON outbox_message(status, next_attempt_at);
CREATE INDEX idx_worker_heartbeat ON worker_instance(worker_type, last_heartbeat_at);

CREATE INDEX idx_test_run_event_run_time ON test_run_event(run_id, occurred_at DESC);
CREATE INDEX idx_report_share_report ON report_share(report_id, created_at DESC);
CREATE INDEX idx_checkpoint_run_step ON checkpoint(source_type, run_id, step_id, created_at);
