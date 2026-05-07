-- 기준 문서: docs/wedge_schema.sql
-- 목적: DB -> MQ outbox 재시도와 callback idempotency에 필요한 런타임 테이블을 dev DB migration에 반영한다.
-- 주의: 정식 스키마 기준은 wedge_schema.sql이며, 이 파일은 해당 기준을 현재 DB 상태에 적용하기 위한 migration이다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 변경 대상: outbox_message(DB write 이후 MQ publish 재시도 저장소)
-- 변경 내용: 테이블 및 pending 조회 인덱스 추가
-- 이유: Run/Discovery/Analysis outbox dispatcher가 부팅 직후 findDueMessages를 조회하므로 테이블이 없으면 API 서버 scheduled task가 반복 실패함
-- 관련 흐름: Run 생성/시작 -> outbox_message 저장 -> RabbitMQ publish -> 실패 시 retryDueMessages 재시도
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

-- 변경 대상: processed_message(callback/message idempotency ledger)
-- 변경 내용: 테이블 추가
-- 이유: Runner/Analyzer callback은 at-least-once 전송을 전제로 하므로 consumer/message_id 중복 처리를 DB에서 보장해야 함
-- 관련 흐름: Runner callback -> ProcessedMessageService -> 중복이면 ack 재응답, 아니면 상태/증거 저장
CREATE TABLE IF NOT EXISTS processed_message (
    consumer_name       VARCHAR(120) NOT NULL,
    message_id          VARCHAR(160) NOT NULL,
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (consumer_name, message_id)
);

-- 변경 대상: worker_instance(worker heartbeat/lock 상태)
-- 변경 내용: 테이블 및 heartbeat 조회 인덱스 추가
-- 이유: Runner/Analyzer worker 상태 추적 기준 테이블을 기준 DDL과 dev migration에 맞춘다.
-- 관련 흐름: worker heartbeat -> stale worker 감지/운영 상태 확인
CREATE TABLE IF NOT EXISTS worker_instance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id           VARCHAR(128) NOT NULL UNIQUE,
    worker_type         VARCHAR(32) NOT NULL CHECK (worker_type IN ('RUNNER','ANALYZER','EXPORTER')),
    status              VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DRAINING','OFFLINE')),
    last_heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata_jsonb      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox_message(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeat
    ON worker_instance(worker_type, last_heartbeat_at);
