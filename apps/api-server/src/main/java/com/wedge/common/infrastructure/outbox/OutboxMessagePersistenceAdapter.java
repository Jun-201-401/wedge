package com.wedge.common.infrastructure.outbox;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.application.AnalysisRequestMessage;
import com.wedge.discovery.application.DiscoveryExecuteRequestMessage;
import com.wedge.run.application.AgentExecuteRequestMessage;
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
    private static final String ANALYSIS_JOB_AGGREGATE_TYPE = "ANALYSIS_JOB";
    private static final String DISCOVERY_AGGREGATE_TYPE = "DISCOVERY";
    private static final String RUN_EXECUTE_EVENT_TYPE = "run.execute.request";
    private static final String AGENT_EXECUTE_EVENT_TYPE = "agent.execute.request";
    private static final String DISCOVERY_EXECUTE_EVENT_TYPE = "discovery.execute.request";
    private static final String ANALYSIS_REQUEST_EVENT_TYPE = "analysis.request";
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
        return appendMessage(RUN_AGGREGATE_TYPE, UUID.fromString(message.correlationId()), message);
    }

    public UUID appendAgentExecuteMessage(AgentExecuteRequestMessage message) {
        return appendMessage(RUN_AGGREGATE_TYPE, UUID.fromString(message.correlationId()), message);
    }

    public UUID appendAnalysisRequestMessage(AnalysisRequestMessage message, UUID analysisJobId) {
        return appendMessage(ANALYSIS_JOB_AGGREGATE_TYPE, analysisJobId, message);
    }

    public UUID appendDiscoveryExecuteMessage(DiscoveryExecuteRequestMessage message, UUID discoveryId) {
        return appendMessage(DISCOVERY_AGGREGATE_TYPE, discoveryId, message);
    }

    private UUID appendMessage(String aggregateType, UUID aggregateId, RunExecuteRequestMessage message) {
        return appendEnvelope(aggregateType, aggregateId, toEnvelope(message));
    }

    private UUID appendMessage(String aggregateType, UUID aggregateId, AgentExecuteRequestMessage message) {
        return appendEnvelope(aggregateType, aggregateId, toEnvelope(message));
    }

    private UUID appendMessage(String aggregateType, UUID aggregateId, AnalysisRequestMessage message) {
        return appendEnvelope(aggregateType, aggregateId, toEnvelope(message));
    }

    private UUID appendMessage(String aggregateType, UUID aggregateId, DiscoveryExecuteRequestMessage message) {
        return appendEnvelope(aggregateType, aggregateId, toEnvelope(message));
    }

    private UUID appendEnvelope(String aggregateType, UUID aggregateId, OutboxEnvelope envelope) {
        UUID outboxMessageId = UUID.randomUUID();
        outboxMessageMapper.insert(new OutboxMessageRecord(
                outboxMessageId,
                aggregateType,
                aggregateId,
                envelope.messageType(),
                writeJson(envelope.toPayloadMap())
        ));
        return outboxMessageId;
    }

    public Optional<RunExecuteRequestMessage> findRunExecuteMessageForPublish(UUID outboxMessageId) {
        return findRunnerRequestMessageForPublish(outboxMessageId);
    }

    public Optional<RunExecuteRequestMessage> findRunnerRequestMessageForPublish(UUID outboxMessageId) {
        return outboxMessageMapper.findById(outboxMessageId, RUN_EXECUTE_EVENT_TYPE, MAX_PUBLISH_ATTEMPTS)
                .map(this::toRunExecuteRequestMessage);
    }

    public Optional<AgentExecuteRequestMessage> findAgentExecuteMessageForPublish(UUID outboxMessageId) {
        return outboxMessageMapper.findById(outboxMessageId, AGENT_EXECUTE_EVENT_TYPE, MAX_PUBLISH_ATTEMPTS)
                .map(this::toAgentExecuteRequestMessage);
    }

    public Optional<AnalysisRequestMessage> findAnalysisRequestMessageForPublish(UUID outboxMessageId) {
        return outboxMessageMapper.findById(outboxMessageId, ANALYSIS_REQUEST_EVENT_TYPE, MAX_PUBLISH_ATTEMPTS)
                .map(this::toAnalysisRequestMessage);
    }

    public Optional<DiscoveryExecuteRequestMessage> findDiscoveryExecuteMessageForPublish(UUID outboxMessageId) {
        return outboxMessageMapper.findById(outboxMessageId, DISCOVERY_EXECUTE_EVENT_TYPE, MAX_PUBLISH_ATTEMPTS)
                .map(this::toDiscoveryExecuteRequestMessage);
    }

    public List<RunExecuteOutboxMessage> findDueRunExecuteMessages(int limit) {
        return findDueMessages(RUN_EXECUTE_EVENT_TYPE, limit);
    }

    private List<RunExecuteOutboxMessage> findDueMessages(String eventType, int limit) {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime pendingBefore = now.minusSeconds(PENDING_RETRY_GRACE_SECONDS);
        return outboxMessageMapper.findDueMessages(
                        eventType,
                        now,
                        pendingBefore,
                        MAX_PUBLISH_ATTEMPTS,
                        limit
                )
                .stream()
                .map(record -> new RunExecuteOutboxMessage(record.getId(), toRunExecuteRequestMessage(record)))
                .toList();
    }

    public List<AgentExecuteOutboxMessage> findDueAgentExecuteMessages(int limit) {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime pendingBefore = now.minusSeconds(PENDING_RETRY_GRACE_SECONDS);
        return outboxMessageMapper.findDueMessages(
                        AGENT_EXECUTE_EVENT_TYPE,
                        now,
                        pendingBefore,
                        MAX_PUBLISH_ATTEMPTS,
                        limit
                )
                .stream()
                .map(record -> new AgentExecuteOutboxMessage(record.getId(), toAgentExecuteRequestMessage(record)))
                .toList();
    }

    public List<AnalysisRequestOutboxMessage> findDueAnalysisRequestMessages(int limit) {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime pendingBefore = now.minusSeconds(PENDING_RETRY_GRACE_SECONDS);
        return outboxMessageMapper.findDueMessages(
                        ANALYSIS_REQUEST_EVENT_TYPE,
                        now,
                        pendingBefore,
                        MAX_PUBLISH_ATTEMPTS,
                        limit
                )
                .stream()
                .map(record -> new AnalysisRequestOutboxMessage(record.getId(), toAnalysisRequestMessage(record)))
                .toList();
    }

    public List<DiscoveryExecuteOutboxMessage> findDueDiscoveryExecuteMessages(int limit) {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime pendingBefore = now.minusSeconds(PENDING_RETRY_GRACE_SECONDS);
        return outboxMessageMapper.findDueMessages(
                        DISCOVERY_EXECUTE_EVENT_TYPE,
                        now,
                        pendingBefore,
                        MAX_PUBLISH_ATTEMPTS,
                        limit
                )
                .stream()
                .map(record -> new DiscoveryExecuteOutboxMessage(record.getId(), toDiscoveryExecuteRequestMessage(record)))
                .toList();
    }

    public void markPublished(UUID outboxMessageId) {
        outboxMessageMapper.markPublished(outboxMessageId, OffsetDateTime.now());
    }

    public void markFailed(UUID outboxMessageId) {
        outboxMessageMapper.markFailed(outboxMessageId, OffsetDateTime.now().plusSeconds(RETRY_DELAY_SECONDS));
    }

    private RunExecuteRequestMessage toRunExecuteRequestMessage(OutboxMessageRecord record) {
        OutboxEnvelope envelope = readEnvelope(record);
        return new RunExecuteRequestMessage(
                envelope.messageId(),
                envelope.messageType(),
                envelope.schemaVersion(),
                envelope.createdAt(),
                envelope.producer(),
                envelope.correlationId(),
                envelope.idempotencyKey(),
                envelope.payload()
        );
    }

    private DiscoveryExecuteRequestMessage toDiscoveryExecuteRequestMessage(OutboxMessageRecord record) {
        OutboxEnvelope envelope = readEnvelope(record);
        return new DiscoveryExecuteRequestMessage(
                envelope.messageId(),
                envelope.messageType(),
                envelope.schemaVersion(),
                envelope.createdAt(),
                envelope.producer(),
                envelope.correlationId(),
                envelope.idempotencyKey(),
                envelope.payload()
        );
    }

    private AgentExecuteRequestMessage toAgentExecuteRequestMessage(OutboxMessageRecord record) {
        OutboxEnvelope envelope = readEnvelope(record);
        return new AgentExecuteRequestMessage(
                envelope.messageId(),
                envelope.messageType(),
                envelope.schemaVersion(),
                envelope.createdAt(),
                envelope.producer(),
                envelope.correlationId(),
                envelope.idempotencyKey(),
                envelope.payload()
        );
    }

    private AnalysisRequestMessage toAnalysisRequestMessage(OutboxMessageRecord record) {
        OutboxEnvelope envelope = readEnvelope(record);
        return new AnalysisRequestMessage(
                envelope.messageId(),
                envelope.messageType(),
                envelope.schemaVersion(),
                envelope.createdAt(),
                envelope.producer(),
                envelope.correlationId(),
                envelope.idempotencyKey(),
                envelope.payload()
        );
    }

    private OutboxEnvelope readEnvelope(OutboxMessageRecord record) {
        return OutboxEnvelope.fromPayloadMap(readJsonMap(record.getPayloadJson()));
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

    private static OutboxEnvelope toEnvelope(RunExecuteRequestMessage message) {
        return new OutboxEnvelope(
                message.messageId(),
                message.messageType(),
                message.schemaVersion(),
                message.createdAt(),
                message.producer(),
                message.correlationId(),
                message.idempotencyKey(),
                message.payload()
        );
    }

    private static OutboxEnvelope toEnvelope(AnalysisRequestMessage message) {
        return new OutboxEnvelope(
                message.messageId(),
                message.messageType(),
                message.schemaVersion(),
                message.createdAt(),
                message.producer(),
                message.correlationId(),
                message.idempotencyKey(),
                message.payload()
        );
    }

    private static OutboxEnvelope toEnvelope(AgentExecuteRequestMessage message) {
        return new OutboxEnvelope(
                message.messageId(),
                message.messageType(),
                message.schemaVersion(),
                message.createdAt(),
                message.producer(),
                message.correlationId(),
                message.idempotencyKey(),
                message.payload()
        );
    }

    private static OutboxEnvelope toEnvelope(DiscoveryExecuteRequestMessage message) {
        return new OutboxEnvelope(
                message.messageId(),
                message.messageType(),
                message.schemaVersion(),
                message.createdAt(),
                message.producer(),
                message.correlationId(),
                message.idempotencyKey(),
                message.payload()
        );
    }

    private static String readString(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        return value == null ? null : value.toString();
    }

    private record OutboxEnvelope(
            String messageId,
            String messageType,
            String schemaVersion,
            String createdAt,
            String producer,
            String correlationId,
            String idempotencyKey,
            Map<String, Object> payload
    ) {
        private Map<String, Object> toPayloadMap() {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("messageId", messageId);
            value.put("messageType", messageType);
            value.put("schemaVersion", schemaVersion);
            value.put("createdAt", createdAt);
            value.put("producer", producer);
            value.put("correlationId", correlationId);
            value.put("idempotencyKey", idempotencyKey);
            value.put("payload", payload);
            return value;
        }

        @SuppressWarnings("unchecked")
        private static OutboxEnvelope fromPayloadMap(Map<String, Object> value) {
            return new OutboxEnvelope(
                    readString(value, "messageId"),
                    readString(value, "messageType"),
                    readString(value, "schemaVersion"),
                    readString(value, "createdAt"),
                    readString(value, "producer"),
                    readString(value, "correlationId"),
                    readString(value, "idempotencyKey"),
                    (Map<String, Object>) value.get("payload")
            );
        }
    }

    public record RunExecuteOutboxMessage(
            UUID outboxMessageId,
            RunExecuteRequestMessage runExecuteRequestMessage
    ) {
    }

    public record AnalysisRequestOutboxMessage(
            UUID outboxMessageId,
            AnalysisRequestMessage analysisRequestMessage
    ) {
    }

    public record AgentExecuteOutboxMessage(
            UUID outboxMessageId,
            AgentExecuteRequestMessage agentExecuteRequestMessage
    ) {
    }

    public record DiscoveryExecuteOutboxMessage(
            UUID outboxMessageId,
            DiscoveryExecuteRequestMessage discoveryExecuteRequestMessage
    ) {
    }
}
