package com.wedge.run.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyClaimRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordResponse;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyReleaseRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRenewRequest;
import com.wedge.run.infrastructure.AgentIdempotencyMapper;
import com.wedge.run.infrastructure.AgentIdempotencyRecord;
import java.time.OffsetDateTime;
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
    public RunnerAgentIdempotencyRecordResponse claimRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyClaimRequest request,
            String workerId
    ) {
        validateKeyHash(idempotencyKeyHash);
        validateWorkerId(workerId);

        AgentIdempotencyRecord claim = claimRecord(idempotencyKeyHash, request, workerId, OffsetDateTime.now());
        agentIdempotencyMapper.insertClaimIgnoreDuplicate(claim);
        agentIdempotencyMapper.claimExpired(claim);
        return findRecord(idempotencyKeyHash);
    }

    @Transactional
    public RunnerAgentIdempotencyRecordResponse renewRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyRenewRequest request,
            String workerId
    ) {
        validateKeyHash(idempotencyKeyHash);
        validateWorkerId(workerId);

        AgentIdempotencyRecord renewal = renewedRecord(idempotencyKeyHash, request, workerId, OffsetDateTime.now());
        agentIdempotencyMapper.renewClaimed(renewal);
        return findRecord(idempotencyKeyHash);
    }

    @Transactional
    public RunnerAgentIdempotencyRecordResponse releaseRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyReleaseRequest request,
            String workerId
    ) {
        validateKeyHash(idempotencyKeyHash);
        validateWorkerId(workerId);

        AgentIdempotencyRecord release = releasedRecord(idempotencyKeyHash, request, workerId);
        agentIdempotencyMapper.releaseClaimed(release);
        return findRecord(idempotencyKeyHash);
    }

    @Transactional
    public RunnerAgentIdempotencyRecordResponse persistRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyRecordRequest request,
            String workerId
    ) {
        validateKeyHash(idempotencyKeyHash);
        validateWorkerId(workerId);

        AgentIdempotencyRecord record = completedRecord(idempotencyKeyHash, request, workerId);
        int updated = agentIdempotencyMapper.completeClaimed(record);
        if (updated == 0) {
            agentIdempotencyMapper.insertCompletedIgnoreDuplicate(record);
        }
        return findRecord(idempotencyKeyHash);
    }

    private RunnerAgentIdempotencyRecordResponse toResponse(AgentIdempotencyRecord record) {
        return new RunnerAgentIdempotencyRecordResponse(
                record.getIdempotencyKeyHash(),
                true,
                record.getStatus(),
                record.getRunId(),
                record.getTaskId(),
                record.getAttemptId(),
                record.getAttemptIndex(),
                record.getClaimedBy(),
                record.getClaimedAt(),
                record.getLeaseExpiresAt(),
                record.getResultJson() == null ? null : readJsonMap(record.getResultJson()),
                record.getCompletedAt()
        );
    }

    private AgentIdempotencyRecord claimRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyClaimRequest request,
            String workerId,
            OffsetDateTime claimedAt
    ) {
        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(idempotencyKeyHash);
        record.setRunId(request.runId());
        record.setTaskId(request.taskId());
        record.setAttemptId(request.attemptId());
        record.setAttemptIndex(request.attemptIndex());
        record.setStatus("CLAIMED");
        record.setClaimedBy(workerId);
        record.setClaimedAt(claimedAt);
        record.setLeaseExpiresAt(claimedAt.plusNanos(request.normalizedLeaseTtlMs() * 1_000_000L));
        return record;
    }

    private AgentIdempotencyRecord completedRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyRecordRequest request,
            String workerId
    ) {
        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(idempotencyKeyHash);
        record.setRunId(request.runId());
        record.setTaskId(request.taskId());
        record.setAttemptId(request.attemptId());
        record.setAttemptIndex(request.attemptIndex());
        record.setStatus("COMPLETED");
        record.setClaimedBy(workerId);
        record.setResultJson(writeJson(request.result()));
        record.setOutcomeStatus(resolveOutcomeStatus(request.result()));
        return record;
    }

    private AgentIdempotencyRecord renewedRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyRenewRequest request,
            String workerId,
            OffsetDateTime renewedAt
    ) {
        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(idempotencyKeyHash);
        record.setRunId(request.runId());
        record.setTaskId(request.taskId());
        record.setAttemptId(request.attemptId());
        record.setAttemptIndex(request.attemptIndex());
        record.setClaimedBy(workerId);
        record.setLeaseExpiresAt(renewedAt.plusNanos(request.normalizedLeaseTtlMs() * 1_000_000L));
        return record;
    }

    private AgentIdempotencyRecord releasedRecord(
            String idempotencyKeyHash,
            RunnerAgentIdempotencyReleaseRequest request,
            String workerId
    ) {
        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(idempotencyKeyHash);
        record.setRunId(request.runId());
        record.setTaskId(request.taskId());
        record.setAttemptId(request.attemptId());
        record.setAttemptIndex(request.attemptIndex());
        record.setClaimedBy(workerId);
        return record;
    }

    private void validateKeyHash(String idempotencyKeyHash) {
        if (idempotencyKeyHash == null || !SHA256_HEX_PATTERN.matcher(idempotencyKeyHash).matches()) {
            throw new BusinessException(
                    ErrorCode.INVALID_REQUEST,
                    "Agent idempotency key hash must be a lowercase SHA-256 hex digest."
            );
        }
    }

    private void validateWorkerId(String workerId) {
        if (workerId == null || workerId.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Runner worker id is required for Agent idempotency operations.");
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
