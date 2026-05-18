-- 기준 문서: docs/wedge_schema.sql
-- 목적: outbox retry 소진 상태와 마지막 publish 오류를 운영자가 조회할 수 있게 한다.

ALTER TABLE outbox_message
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS exhausted_at TIMESTAMPTZ;

DO $$
DECLARE
    status_constraint_name TEXT;
BEGIN
    SELECT conname
    INTO status_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.outbox_message'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%PENDING%'
      AND pg_get_constraintdef(oid) LIKE '%PUBLISHED%'
      AND pg_get_constraintdef(oid) LIKE '%FAILED%'
    LIMIT 1;

    IF status_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE outbox_message DROP CONSTRAINT %I', status_constraint_name);
    END IF;
END $$;

ALTER TABLE outbox_message
    ADD CONSTRAINT outbox_message_status_check
    CHECK (status IN ('PENDING','PUBLISHED','FAILED','EXHAUSTED'));

UPDATE outbox_message
SET status = 'EXHAUSTED',
    exhausted_at = COALESCE(exhausted_at, NOW()),
    last_error = COALESCE(last_error, 'outbox retry attempts were exhausted before migration')
WHERE status = 'FAILED'
  AND attempt_count >= 10;

CREATE INDEX IF NOT EXISTS idx_outbox_exhausted
    ON outbox_message(status, exhausted_at)
    WHERE status = 'EXHAUSTED';
