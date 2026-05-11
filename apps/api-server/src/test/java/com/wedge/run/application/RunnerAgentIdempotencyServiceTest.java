package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyClaimRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordRequest;
import com.wedge.run.infrastructure.AgentIdempotencyMapper;
import com.wedge.run.infrastructure.AgentIdempotencyRecord;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RunnerAgentIdempotencyServiceTest {
    private static final String KEY_HASH = "a".repeat(64);

    @Mock
    private AgentIdempotencyMapper agentIdempotencyMapper;

    @Captor
    private ArgumentCaptor<AgentIdempotencyRecord> recordCaptor;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void findRecordReturnsEmptyEnvelopeWhenRecordIsMissing() {
        when(agentIdempotencyMapper.findByKeyHash(KEY_HASH)).thenReturn(Optional.empty());

        var response = service().findRecord(KEY_HASH);

        assertThat(response.found()).isFalse();
        assertThat(response.idempotencyKeyHash()).isEqualTo(KEY_HASH);
        assertThat(response.result()).isNull();
    }

    @Test
    void persistRecordStoresFirstWriterResultAndReturnsStoredRecord() {
        UUID runId = UUID.randomUUID();
        RunnerAgentIdempotencyRecordRequest request = new RunnerAgentIdempotencyRecordRequest(
                runId,
                "task-1",
                "attempt-1",
                2,
                Map.of(
                        "runId", runId.toString(),
                        "trace", Map.of(
                                "task_id", "task-1",
                                "attempt_id", "attempt-1",
                                "attempt_index", 2,
                                "outcome", Map.of("status", "SUCCESS")
                        )
                )
        );
        AgentIdempotencyRecord stored = storedRecord(runId);
        when(agentIdempotencyMapper.completeClaimed(any())).thenReturn(1);
        when(agentIdempotencyMapper.findByKeyHash(KEY_HASH)).thenReturn(Optional.of(stored));

        var response = service().persistRecord(KEY_HASH, request, "runner-1");

        verify(agentIdempotencyMapper).completeClaimed(recordCaptor.capture());
        AgentIdempotencyRecord inserted = recordCaptor.getValue();
        assertThat(inserted.getIdempotencyKeyHash()).isEqualTo(KEY_HASH);
        assertThat(inserted.getRunId()).isEqualTo(runId);
        assertThat(inserted.getTaskId()).isEqualTo("task-1");
        assertThat(inserted.getAttemptId()).isEqualTo("attempt-1");
        assertThat(inserted.getAttemptIndex()).isEqualTo(2);
        assertThat(inserted.getStatus()).isEqualTo("COMPLETED");
        assertThat(inserted.getClaimedBy()).isEqualTo("runner-1");
        assertThat(inserted.getOutcomeStatus()).isEqualTo("SUCCESS");
        assertThat(inserted.getResultJson()).contains("\"attempt_index\":2");

        assertThat(response.found()).isTrue();
        assertThat(response.status()).isEqualTo("COMPLETED");
        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.result()).containsEntry("runId", runId.toString());
    }

    @Test
    void claimRecordCreatesLeaseAndReturnsStoredClaim() {
        UUID runId = UUID.randomUUID();
        RunnerAgentIdempotencyClaimRequest request = new RunnerAgentIdempotencyClaimRequest(
                runId,
                "task-1",
                "attempt-1",
                2,
                120_000L
        );
        AgentIdempotencyRecord stored = storedClaim(runId);
        when(agentIdempotencyMapper.findByKeyHash(KEY_HASH)).thenReturn(Optional.of(stored));

        var response = service().claimRecord(KEY_HASH, request, "runner-1");

        verify(agentIdempotencyMapper).insertClaimIgnoreDuplicate(recordCaptor.capture());
        AgentIdempotencyRecord claim = recordCaptor.getValue();
        assertThat(claim.getIdempotencyKeyHash()).isEqualTo(KEY_HASH);
        assertThat(claim.getRunId()).isEqualTo(runId);
        assertThat(claim.getTaskId()).isEqualTo("task-1");
        assertThat(claim.getAttemptId()).isEqualTo("attempt-1");
        assertThat(claim.getAttemptIndex()).isEqualTo(2);
        assertThat(claim.getStatus()).isEqualTo("CLAIMED");
        assertThat(claim.getClaimedBy()).isEqualTo("runner-1");
        assertThat(claim.getLeaseExpiresAt()).isAfter(claim.getClaimedAt());

        assertThat(response.found()).isTrue();
        assertThat(response.status()).isEqualTo("CLAIMED");
        assertThat(response.claimedBy()).isEqualTo("runner-1");
        assertThat(response.result()).isNull();
    }

    @Test
    void invalidKeyHashIsRejectedBeforeDbAccess() {
        assertThatThrownBy(() -> service().findRecord("raw-key"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("SHA-256");
    }

    private RunnerAgentIdempotencyService service() {
        return new RunnerAgentIdempotencyService(agentIdempotencyMapper, objectMapper);
    }

    private AgentIdempotencyRecord storedRecord(UUID runId) {
        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(KEY_HASH);
        record.setRunId(runId);
        record.setTaskId("task-1");
        record.setAttemptId("attempt-1");
        record.setAttemptIndex(2);
        record.setStatus("COMPLETED");
        record.setClaimedBy("runner-1");
        record.setClaimedAt(OffsetDateTime.parse("2026-05-08T09:55:00+09:00"));
        record.setLeaseExpiresAt(OffsetDateTime.parse("2026-05-08T10:05:00+09:00"));
        record.setResultJson("{\"runId\":\"" + runId + "\",\"trace\":{\"outcome\":{\"status\":\"SUCCESS\"}}}");
        record.setOutcomeStatus("SUCCESS");
        record.setCompletedAt(OffsetDateTime.parse("2026-05-08T10:00:00+09:00"));
        return record;
    }

    private AgentIdempotencyRecord storedClaim(UUID runId) {
        AgentIdempotencyRecord record = new AgentIdempotencyRecord();
        record.setIdempotencyKeyHash(KEY_HASH);
        record.setRunId(runId);
        record.setTaskId("task-1");
        record.setAttemptId("attempt-1");
        record.setAttemptIndex(2);
        record.setStatus("CLAIMED");
        record.setClaimedBy("runner-1");
        record.setClaimedAt(OffsetDateTime.parse("2026-05-08T10:00:00+09:00"));
        record.setLeaseExpiresAt(OffsetDateTime.parse("2026-05-08T10:02:00+09:00"));
        return record;
    }
}
