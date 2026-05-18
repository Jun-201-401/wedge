package com.wedge.common.infrastructure.outbox;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class OutboxMessagePersistenceAdapterTest {
    @Mock
    private OutboxMessageMapper outboxMessageMapper;

    private OutboxMessagePersistenceAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new OutboxMessagePersistenceAdapter(outboxMessageMapper, new ObjectMapper());
    }

    @Test
    void markFailedPersistsLastErrorAndMaxAttemptsForExhaustionTransition() {
        UUID outboxMessageId = UUID.randomUUID();
        IllegalStateException cause = new IllegalStateException("broker unavailable");

        adapter.markFailed(outboxMessageId, cause);

        verify(outboxMessageMapper).markFailed(
                eq(outboxMessageId),
                any(OffsetDateTime.class),
                any(OffsetDateTime.class),
                eq(10),
                eq("java.lang.IllegalStateException: broker unavailable")
        );
    }

    @Test
    void markFailedTruncatesLongErrorText() {
        UUID outboxMessageId = UUID.randomUUID();
        RuntimeException cause = new RuntimeException("x".repeat(1_200));
        ArgumentCaptor<String> errorCaptor = ArgumentCaptor.forClass(String.class);

        adapter.markFailed(outboxMessageId, cause);

        verify(outboxMessageMapper).markFailed(
                eq(outboxMessageId),
                any(OffsetDateTime.class),
                any(OffsetDateTime.class),
                eq(10),
                errorCaptor.capture()
        );
        assertThat(errorCaptor.getValue()).hasSize(1_000);
    }
}
