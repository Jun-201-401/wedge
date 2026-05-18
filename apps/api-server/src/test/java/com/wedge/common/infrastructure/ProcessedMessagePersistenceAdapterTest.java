package com.wedge.common.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ProcessedMessagePersistenceAdapterTest {
    @Mock
    private ProcessedMessageMapper processedMessageMapper;

    private ProcessedMessagePersistenceAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new ProcessedMessagePersistenceAdapter(processedMessageMapper, new ObjectMapper());
    }

    @Test
    void tryMarkProcessedPersistsPayloadHashForNewMessage() {
        when(processedMessageMapper.insertIgnoreDuplicate(eq("runner.accepted"), eq("evt_001"), anyString()))
                .thenReturn(1);
        ArgumentCaptor<String> hashCaptor = ArgumentCaptor.forClass(String.class);

        boolean inserted = adapter.tryMarkProcessed("runner.accepted", "evt_001", Map.of("runId", "run-1"));

        assertThat(inserted).isTrue();
        verify(processedMessageMapper).insertIgnoreDuplicate(eq("runner.accepted"), eq("evt_001"), hashCaptor.capture());
        assertThat(hashCaptor.getValue()).matches("[0-9a-f]{64}");
    }

    @Test
    void tryMarkProcessedReturnsDuplicateWhenExistingPayloadHashMatches() {
        AtomicReference<String> insertedHash = new AtomicReference<>();
        when(processedMessageMapper.insertIgnoreDuplicate(eq("runner.accepted"), eq("evt_001"), anyString()))
                .thenAnswer(invocation -> {
                    insertedHash.set(invocation.getArgument(2));
                    return 0;
                });
        when(processedMessageMapper.findPayloadHash("runner.accepted", "evt_001"))
                .thenAnswer(invocation -> Optional.of(insertedHash.get()));

        boolean inserted = adapter.tryMarkProcessed("runner.accepted", "evt_001", Map.of("runId", "run-1"));

        assertThat(inserted).isFalse();
    }

    @Test
    void tryMarkProcessedRejectsSameEventIdWithDifferentPayloadHash() {
        when(processedMessageMapper.insertIgnoreDuplicate(eq("runner.accepted"), eq("evt_001"), anyString()))
                .thenReturn(0);
        when(processedMessageMapper.findPayloadHash("runner.accepted", "evt_001"))
                .thenReturn(Optional.of("0".repeat(64)));

        assertThatThrownBy(() -> adapter.tryMarkProcessed("runner.accepted", "evt_001", Map.of("runId", "run-1")))
                .isInstanceOf(BusinessException.class)
                .satisfies(exception -> assertThat(((BusinessException) exception).errorCode()).isEqualTo(ErrorCode.STATE_CONFLICT));
    }
}
