package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.run.api.internal.runner.dto.RunnerMessageIdempotencyRecordRequest;
import com.wedge.run.infrastructure.RunnerMessageIdempotencyMapper;
import com.wedge.run.infrastructure.RunnerMessageIdempotencyRecord;
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
class RunnerMessageIdempotencyServiceTest {
    private static final String KEY_HASH = "b".repeat(64);

    @Mock
    private RunnerMessageIdempotencyMapper runnerMessageIdempotencyMapper;

    @Captor
    private ArgumentCaptor<RunnerMessageIdempotencyRecord> recordCaptor;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void findRecordReturnsEmptyEnvelopeWhenRecordIsMissing() {
        when(runnerMessageIdempotencyMapper.findByScopeAndKeyHash("run", KEY_HASH)).thenReturn(Optional.empty());

        var response = service().findRecord("run", KEY_HASH);

        assertThat(response.found()).isFalse();
        assertThat(response.scope()).isEqualTo("run");
        assertThat(response.idempotencyKeyHash()).isEqualTo(KEY_HASH);
        assertThat(response.result()).isNull();
    }

    @Test
    void persistRecordStoresFirstWriterResultAndReturnsStoredRecord() {
        UUID runId = UUID.randomUUID();
        RunnerMessageIdempotencyRecordRequest request = new RunnerMessageIdempotencyRecordRequest(
                runId,
                Map.of(
                        "runId", runId.toString(),
                        "delivery", Map.of("status", "DELIVERY_COMPLETE")
                )
        );
        RunnerMessageIdempotencyRecord stored = storedRecord(runId);
        when(runnerMessageIdempotencyMapper.findByScopeAndKeyHash("run", KEY_HASH)).thenReturn(Optional.of(stored));

        var response = service().persistRecord("run", KEY_HASH, request);

        verify(runnerMessageIdempotencyMapper).insertCompletedIgnoreDuplicate(recordCaptor.capture());
        RunnerMessageIdempotencyRecord inserted = recordCaptor.getValue();
        assertThat(inserted.getScope()).isEqualTo("run");
        assertThat(inserted.getIdempotencyKeyHash()).isEqualTo(KEY_HASH);
        assertThat(inserted.getRunId()).isEqualTo(runId);
        assertThat(inserted.getResultJson()).contains("DELIVERY_COMPLETE");

        assertThat(response.found()).isTrue();
        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.result()).containsEntry("runId", runId.toString());
    }

    @Test
    void invalidScopeIsRejectedBeforeDbAccess() {
        assertThatThrownBy(() -> service().findRecord("agent", KEY_HASH))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("scope");
    }

    @Test
    void invalidKeyHashIsRejectedBeforeDbAccess() {
        assertThatThrownBy(() -> service().findRecord("run", "raw-key"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("SHA-256");
    }

    private RunnerMessageIdempotencyService service() {
        return new RunnerMessageIdempotencyService(runnerMessageIdempotencyMapper, objectMapper);
    }

    private RunnerMessageIdempotencyRecord storedRecord(UUID runId) {
        RunnerMessageIdempotencyRecord record = new RunnerMessageIdempotencyRecord();
        record.setScope("run");
        record.setIdempotencyKeyHash(KEY_HASH);
        record.setRunId(runId);
        record.setResultJson("{\"runId\":\"" + runId + "\",\"delivery\":{\"status\":\"DELIVERY_COMPLETE\"}}");
        record.setCompletedAt(OffsetDateTime.parse("2026-05-12T10:00:00+09:00"));
        return record;
    }
}
