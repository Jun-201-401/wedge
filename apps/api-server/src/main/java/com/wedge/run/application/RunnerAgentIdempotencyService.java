package com.wedge.run.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordResponse;
import com.wedge.run.infrastructure.AgentIdempotencyMapper;
import com.wedge.run.infrastructure.AgentIdempotencyRecord;
import java.util.Map;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunnerAgentIdempotencyService {
    private static final Pattern SHA256_HEX_PATTERN = Pattern.compile("^[0-9a-f]{64}$");
    private static final TypeReference<Map<String, Object>> JSON_MAP_TYPE = new TypeReference<>() {};

    private final AgentIdempotencyMapper agentIdempotencyMapper;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public RunnerAgentIdempotencyRecordResponse findRecord(String idempotencyKeyHash) {
        validateKeyHash(idempotencyKeyHash);
        return agentIdempotencyMapper.findByKeyHash(idempotencyKeyHash)
                .map(this::toResponse)
                .orElseGet(() -> RunnerAgentIdempotencyRecordResponse.empty(idempotencyKeyHash));
    }

    @Transactional
    public RunnerAgentIdempotencyRecordResponse persistRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyRecordRequest request
    ) {
        validateKeyHash(idempotencyKeyHash);

        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(idempotencyKeyHash);
        record.setRunId(request.runId());
        record.setTaskId(request.taskId());
        record.setAttemptId(request.attemptId());
        record.setAttemptIndex(request.attemptIndex());
        record.setResultJson(writeJson(request.result()));
        record.setOutcomeStatus(resolveOutcomeStatus(request.result()));

        agentIdempotencyMapper.insertIgnoreDuplicate(record);
        return findRecord(idempotencyKeyHash);
    }

    private RunnerAgentIdempotencyRecordResponse toResponse(AgentIdempotencyRecord record) {
        return new RunnerAgentIdempotencyRecordResponse(
                record.getIdempotencyKeyHash(),
                true,
                record.getRunId(),
                record.getTaskId(),
                record.getAttemptId(),
                record.getAttemptIndex(),
                readJsonMap(record.getResultJson()),
                record.getCompletedAt()
        );
    }

    private void validateKeyHash(String idempotencyKeyHash) {
        if (idempotencyKeyHash == null || !SHA256_HEX_PATTERN.matcher(idempotencyKeyHash).matches()) {
            throw new BusinessException(
                    ErrorCode.INVALID_REQUEST,
                    "Agent idempotency key hash must be a lowercase SHA-256 hex digest."
            );
        }
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Agent idempotency result must be JSON serializable.", null, exception);
        }
    }

    private Map<String, Object> readJsonMap(String value) {
        try {
            return objectMapper.readValue(value, JSON_MAP_TYPE);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Stored agent idempotency result is not readable.", null, exception);
        }
    }

    @SuppressWarnings("unchecked")
    private String resolveOutcomeStatus(Map<String, Object> result) {
        Object trace = result.get("trace");
        if (!(trace instanceof Map<?, ?> traceMap)) {
            return "UNKNOWN";
        }
        Object outcome = traceMap.get("outcome");
        if (!(outcome instanceof Map<?, ?> outcomeMap)) {
            return "UNKNOWN";
        }
        Object status = outcomeMap.get("status");
        return status instanceof String text && !text.isBlank() ? text : "UNKNOWN";
    }
}
