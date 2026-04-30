-- 기준 문서: docs/wedge_schema.sql
-- 목적: Analyzer가 MQ 메시지의 evidencePacketId를 기준으로 분석 입력 snapshot을 추적할 수 있게 한다.
-- 주의: 정식 스키마 기준은 wedge_schema.sql이며, 이 파일은 해당 기준을 현재 DB 상태에 적용하기 위한 migration이다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 변경 대상: evidence_packet(분석 요청 시점의 EvidencePacket snapshot)
-- 변경 내용: 테이블 추가
-- 이유: analysis.request에는 full EvidencePacket 대신 evidencePacketId를 담고, analysis_job이 어떤 입력 snapshot을 분석했는지 남겨야 함
-- 관련 흐름: Run 완료 -> EvidencePacket snapshot 저장 -> analysis.request -> Analyzer 조회/분석 -> callback 저장
CREATE TABLE IF NOT EXISTS evidence_packet (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_type      VARCHAR(16) NOT NULL DEFAULT 'RUN' CHECK (execution_type IN ('RUN','DISCOVERY')),
    run_id              UUID REFERENCES test_run(id) ON DELETE CASCADE,
    discovery_id        UUID REFERENCES site_discovery(id) ON DELETE CASCADE,
    schema_version      VARCHAR(32) NOT NULL,
    packet_jsonb        JSONB NOT NULL,
    checkpoint_count    INTEGER NOT NULL DEFAULT 0,
    observation_count   INTEGER NOT NULL DEFAULT 0,
    artifact_count      INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (execution_type = 'RUN' AND run_id IS NOT NULL)
        OR (execution_type = 'DISCOVERY' AND discovery_id IS NOT NULL)
    )
);

ALTER TABLE evidence_packet
    ADD COLUMN IF NOT EXISTS artifact_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF to_regclass('public.analysis_job') IS NOT NULL THEN
        ALTER TABLE analysis_job
            ADD COLUMN IF NOT EXISTS evidence_packet_id UUID;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_analysis_job_evidence_packet'
              AND conrelid = 'public.analysis_job'::regclass
        ) THEN
            ALTER TABLE analysis_job
                ADD CONSTRAINT fk_analysis_job_evidence_packet
                FOREIGN KEY (evidence_packet_id) REFERENCES evidence_packet(id);
        END IF;
    END IF;
END $$;

-- 변경 대상: evidence_packet unique key
-- 변경 내용: run / discovery별 schema_version snapshot을 1개로 고정
-- 이유: 같은 Run의 동일 schema EvidencePacket은 재요청해도 최초 snapshot row를 재사용해야 이전 analysis_job 입력이 흔들리지 않음
-- 관련 흐름: 중복 analysis.request -> 동일 evidencePacketId 재사용 -> analysis_job.evidence_packet_id 연결
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_packet_run_schema
    ON evidence_packet(run_id, schema_version);

CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_packet_discovery_schema
    ON evidence_packet(discovery_id, schema_version);
