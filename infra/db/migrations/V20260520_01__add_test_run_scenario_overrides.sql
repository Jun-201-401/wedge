-- 변경 대상: test_run(run creation aggregate)
-- 이유: Agent 실행이 추천 카드에 표시한 진입점(suggestedTarget)을 실행 계약으로 재사용할 수 있도록 원본 선택 메타데이터를 보존한다.
ALTER TABLE test_run
    ADD COLUMN IF NOT EXISTS scenario_overrides_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb;
