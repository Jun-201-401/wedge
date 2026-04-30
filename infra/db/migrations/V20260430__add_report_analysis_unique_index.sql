-- 기준 문서: docs/wedge_schema.sql
-- 목적: completed analysis 1건에서 생성되는 report row를 DB 레벨에서 1개로 고정한다.
-- 주의: 정식 스키마 기준은 wedge_schema.sql이며, 이 파일은 해당 기준을 현재 DB 상태에 적용하기 위한 migration이다.

-- 변경 대상: report.analysis_job_id(분석 작업과 리포트 row 연결 키)
-- 변경 내용: 삭제되지 않은 report 기준 analysis_job_id unique index 추가
-- 이유: 동시에 POST /report가 호출되어도 같은 analysis_job_id에 대해 report row가 중복 생성되지 않아야 함
-- 관련 흐름: completed analysis -> report 생성 API -> report summary/detail 조회
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_active_analysis_job
    ON report(analysis_job_id)
    WHERE deleted_at IS NULL;
