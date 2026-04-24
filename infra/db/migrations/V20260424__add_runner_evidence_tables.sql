-- 기준 문서: docs/wedge_schema.sql
-- 목적: Runner callback에서 들어오는 checkpoint / artifact 저장 경로를 현재 DB에도 반영한다.
-- 주의: 정식 스키마 기준은 wedge_schema.sql이며, 이 파일은 해당 기준을 현재 DB 상태에 적용하기 위한 migration이다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 변경 대상: artifact(실행 중 수집한 스크린샷/DOM/trace 등 증거 자료 메타데이터)
-- 변경 내용: 테이블 추가
-- 이유: Runner artifact callback이 어떤 run / step에서 생성된 증거 자료인지 Spring이 저장할 수 있어야 함
-- 관련 흐름: Runner artifact callback -> Spring 저장 -> report / analysis / 최신 자료 조회
CREATE TABLE IF NOT EXISTS artifact (
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

-- 변경 대상: checkpoint(의미 있는 상태 변화 시점의 캡처)
-- 변경 내용: 테이블 추가
-- 이유: Runner checkpoint callback이 남기는 상태 기록을 run / step 기준으로 저장해야 이후 observation / evidence_packet 흐름이 이어짐
-- 관련 흐름: Runner checkpoint callback -> Spring 저장 -> evidence_packet 생성 -> analysis.request
CREATE TABLE IF NOT EXISTS checkpoint (
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

-- 변경 대상: artifact / checkpoint 조회 인덱스
-- 변경 내용: run / discovery / step 기준 인덱스 추가
-- 이유: callback 저장 직후 최신 자료, 특정 run 자료, step 연결 자료를 안정적으로 조회하기 위함
-- 관련 흐름: callback 저장 -> run 최신 상태 조회 / evidence 생성 / 리포트 조회
CREATE INDEX IF NOT EXISTS idx_checkpoint_discovery_captured
    ON checkpoint(source_type, discovery_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_artifact_discovery_created
    ON artifact(source_type, discovery_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkpoint_run_captured
    ON checkpoint(source_type, run_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_artifact_run_created
    ON artifact(source_type, run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkpoint_run_step
    ON checkpoint(source_type, run_id, step_id, created_at);
