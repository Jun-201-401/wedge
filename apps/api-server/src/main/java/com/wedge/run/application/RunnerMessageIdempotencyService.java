package com.wedge.run.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.internal.runner.dto.RunnerMessageIdempotencyRecordRequest;
import com.wedge.run.api.internal.runner.dto.RunnerMessageIdempotencyRecordResponse;
import com.wedge.run.infrastructure.RunnerMessageIdempotencyMapper;
import com.wedge.run.infrastructure.RunnerMessageIdempotencyRecord;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunnerMessageIdempotencyService {
    private static final Pattern SHA256_HEX_PATTERN = Pattern.compile("^[0-9a-f]{64}$");
    private static final Set<String> SCOPES = Set.of("run", "discovery");
    private static final TypeReference<Map<String, Object>> JSON_MAP_TYPE = new TypeReference<>() {};

    private final RunnerMessageIdempotencyMapper runnerMessageIdempotencyMapper;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public RunnerMessageIdempotencyRecordResponse findRecord(String scope, String idempotencyKeyHash) {
        validateScope(scope);
        validateKeyHash(idempotencyKeyHash);
        return runnerMessageIdempotencyMapper.findByScopeAndKeyHash(scope, idempotencyKeyHash)
                .map(this::toResponse)
                .orElseGet(() -> RunnerMessageIdempotencyRecordResponse.empty(scope, idempotencyKeyHash));
    }

    @Transactional
    public RunnerMessageIdempotencyRecordResponse persistRecord(
            String scope,
            String idempotencyKeyHash,
            RunnerMessageIdempotencyRecordRequest request
    ) {
        validateScope(scope);
        validateKeyHash(idempotencyKeyHash);

        RunnerMessageIdempotencyRecord record = new RunnerMessageIdempotencyRecord();
        record.setScope(scope);
        record.setIdempotencyKeyHash(idempotencyKeyHash);
        record.setRunId(request.runId());
        record.setResultJson(writeJson(request.result()));
        runnerMessageIdempotencyMapper.insertCompletedIgnoreDuplicate(record);
        return findRecord(scope, idempotencyKeyHash);
    }

    private RunnerMessageIdempotencyRecordResponse toResponse(RunnerMessageIdempotencyRecord record) {
        return new RunnerMessageIdempotencyRecordResponse(
                record.getScope(),
                record.getIdempotencyKeyHash(),
                true,
                record.getRunId(),
                readJsonMap(record.getResultJson()),
                record.getCompletedAt()
        );
    }

    private void validateScope(String scope) {
        if (!SCOPES.contains(scope)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Runner message idempotency scope must be run or discovery.");
        }
    }

    private void validateKeyHash(String idempotencyKeyHash) {
        if (idempotencyKeyHash == null || !SHA256_HEX_PATTERN.matcher(idempotencyKeyHash).matches()) {
            throw new BusinessException(
                    ErrorCode.INVALID_REQUEST,
                    "Runner message idempotency key hash must be a lowercase SHA-256 hex digest."
            );
        }
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Runner message idempotency result must be JSON serializable.", null, exception);
        }
    }

    private Map<String, Object> readJsonMap(String value) {
        try {
            return objectMapper.readValue(value, JSON_MAP_TYPE);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Stored runner message idempotency result is not readable.", null, exception);
        }
    }
}
