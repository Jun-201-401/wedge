-- 기준 문서: docs/wedge_schema.sql
-- 목적: 사용자 기본 Agent 실행은 ScenarioPlan 없이 agent.execute.request로 발행되므로 template FK를 선택값으로 완화한다.
-- 주의: run.execute.request 재생 경로는 여전히 scenario_template_version_id + scenario_plan을 요구한다.

ALTER TABLE test_run
    ALTER COLUMN scenario_template_version_id DROP NOT NULL;
