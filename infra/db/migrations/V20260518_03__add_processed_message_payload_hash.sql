-- 변경 대상: processed_message(callback/message idempotency ledger)
-- 변경 내용: 동일 event id가 다른 payload로 재사용되는 경우를 감지하기 위한 payload hash 추가
-- 이유: event id 단독 중복 처리는 잘못된 재전송 payload를 정상 duplicate ack로 숨길 수 있다.
ALTER TABLE processed_message
    ADD COLUMN IF NOT EXISTS payload_hash VARCHAR(64);
