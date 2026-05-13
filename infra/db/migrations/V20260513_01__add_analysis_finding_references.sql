-- Basis document: docs/wedge_schema.sql
-- Purpose: preserve Analyzer issue reference metadata for Report Detail reference badges.

ALTER TABLE analysis_finding
    ADD COLUMN IF NOT EXISTS references_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb;
