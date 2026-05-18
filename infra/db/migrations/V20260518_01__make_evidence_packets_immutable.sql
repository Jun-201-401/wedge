-- 기준 문서: docs/wedge_schema.sql
-- 목적: analysis_job.evidence_packet_id가 분석 요청 시점의 정확한 EvidencePacket bytes를 계속 가리키도록 한다.
-- 이유: run_id/schema_version 단일 row 재사용은 stale packet을 재사용하고, refresh-on-conflict는 과거 analysis_job 입력을 바꿀 수 있다.

DROP INDEX IF EXISTS ux_evidence_packet_run_schema;
DROP INDEX IF EXISTS ux_evidence_packet_discovery_schema;

CREATE INDEX IF NOT EXISTS idx_evidence_packet_run_schema_created
    ON evidence_packet(run_id, schema_version, created_at DESC)
    WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_packet_discovery_schema_created
    ON evidence_packet(discovery_id, schema_version, created_at DESC)
    WHERE discovery_id IS NOT NULL;
