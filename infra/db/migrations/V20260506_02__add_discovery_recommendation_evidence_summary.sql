-- 목적: Discovery recommendation별 구조화된 matched/missing/limitation evidence를 보존한다.

ALTER TABLE scenario_recommendation
    ADD COLUMN IF NOT EXISTS evidence_summary_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb;
