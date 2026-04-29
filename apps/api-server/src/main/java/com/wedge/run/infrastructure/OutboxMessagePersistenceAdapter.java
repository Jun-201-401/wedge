package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.run.application.RunExecuteRequestMessage;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class OutboxMessagePersistenceAdapter {
    private static final String RUN_AGGREGATE_TYPE = "RUN";
    private static final String RUN_EXECUTE_EVENT_TYPE = "run.execute.request";
    private static final long PENDING_RETRY_GRACE_SECONDS = 5;
    private static final long RETRY_DELAY_SECONDS = 30;
    private static final int MAX_PUBLISH_ATTEMPTS = 10;

    private final OutboxMessageMapper outboxMessageMapper;
    private final ObjectMapper objectMapper;

    public OutboxMessagePersistenceAdapter(OutboxMessageMapper outboxMessageMapper, ObjectMapper objectMapper) {
        this.outboxMessageMapper = outboxMessageMapper;
        this.objectMapper = objectMapper;
    }

    public UUID appendRunExecuteMessage(RunExecuteRequestMessage message) {
        UUID outboxMessageId = UUID.randomUUID();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messageId", message.messageId());
        payload.put("messageType", message.messageType());
        payload.put("schemaVersion", message.schemaVersion());
        payload.put("createdAt", message.createdAt());
        payload.put("producer", message.producer());
        payload.put("correlationId", message.correlationId());
        payload.put("idempotencyKey", message.idempotencyKey());
        payload.put("payload", message.payload());

        outboxMessageMapper.insert(new OutboxMessageRecord(
                outboxMessageId,
                RUN_AGGREGATE_TYPE,
                UUID.fromString(message.correlationId()),
                message.messageType(),
                writeJson(payload)
        ));
        return outboxMessageId;
    }

    public Optional<RunExecuteRequestMessage> findRunExecuteMessageForPublish(UUID outboxMessageId) {
        return outboxMessageMapper.findById(outboxMessageId, RUN_EXECUTE_EVENT_TYPE, MAX_PUBLISH_ATTEMPTS)
                .map(this::toRunExecuteRequestMessage);
    }

    public List<RunExecuteOutboxMessage> findDueRunExecuteMessages(int limit) {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime pendingBefore = now.minusSeconds(PENDING_RETRY_GRACE_SECONDS);
        return outboxMessageMapper.findDueRunExecuteMessages(
                        RUN_EXECUTE_EVENT_TYPE,
                        now,
                        pendingBefore,
                        MAX_PUBLISH_ATTEMPTS,
                        limit
                )
                .stream()
                .map(record -> new RunExecuteOutboxMessage(record.getId(), toRunExecuteRequestMessage(record)))
                .toList();
    }

    public void markPublished(UUID outboxMessageId) {
        outboxMessageMapper.markPublished(outboxMessageId, OffsetDateTime.now());
    }

    public void markFailed(UUID outboxMessageId) {
        outboxMessageMapper.markFailed(outboxMessageId, OffsetDateTime.now().plusSeconds(RETRY_DELAY_SECONDS));
    }

    private RunExecuteRequestMessage toRunExecuteRequestMessage(OutboxMessageRecord record) {
        Map<String, Object> payload = readJsonMap(record.getPayloadJson());
        @SuppressWarnings("unchecked")
        Map<String, Object> messagePayload = (Map<String, Object>) payload.get("payload");
        return new RunExecuteRequestMessage(
                readString(payload, "messageId"),
                readString(payload, "messageType"),
                readString(payload, "schemaVersion"),
                readString(payload, "createdAt"),
                readString(payload, "producer"),
                readString(payload, "correlationId"),
                readString(payload, "idempotencyKey"),
                messagePayload
        );
    }

    private String writeJson(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize outbox payload", exception);
        }
    }

    private Map<String, Object> readJsonMap(String rawJson) {
        try {
            return objectMapper.readValue(rawJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to deserialize outbox payload", exception);
        }
    }

    private String readString(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        return value == null ? null : value.toString();
    }

    public record RunExecuteOutboxMessage(
            UUID outboxMessageId,
            RunExecuteRequestMessage runExecuteRequestMessage
    ) {
    }
}
