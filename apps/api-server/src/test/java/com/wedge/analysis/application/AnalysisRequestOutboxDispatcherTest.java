package com.wedge.analysis.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

@ExtendWith(MockitoExtension.class)
class AnalysisRequestOutboxDispatcherTest {
    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private AnalysisRequestPublisher analysisRequestPublisher;

    private AnalysisRequestOutboxDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new AnalysisRequestOutboxDispatcher(outboxMessagePersistenceAdapter, analysisRequestPublisher);
    }

    @Test
    void outboxEventListenerUsesNewTransactionAfterCommit() throws NoSuchMethodException {
        Method handle = AnalysisRequestOutboxDispatcher.class.getDeclaredMethod(
                "handle",
                AnalysisRequestOutboxEnqueuedEvent.class
        );

        Transactional transactional = handle.getAnnotation(Transactional.class);
        TransactionalEventListener eventListener = handle.getAnnotation(TransactionalEventListener.class);

        assertThat(eventListener).isNotNull();
        assertThat(transactional).isNotNull();
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void handlePublishesOnlyWhenMessageCanBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        AnalysisRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findAnalysisRequestMessageForPublish(outboxMessageId))
                .thenReturn(Optional.of(message));

        dispatcher.handle(new AnalysisRequestOutboxEnqueuedEvent(outboxMessageId));

        InOrder inOrder = inOrder(analysisRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findAnalysisRequestMessageForPublish(outboxMessageId);
        inOrder.verify(analysisRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void handleSkipsPublishWhenMessageCannotBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        when(outboxMessagePersistenceAdapter.findAnalysisRequestMessageForPublish(outboxMessageId))
                .thenReturn(Optional.empty());

        dispatcher.handle(new AnalysisRequestOutboxEnqueuedEvent(outboxMessageId));

        verifyNoInteractions(analysisRequestPublisher);
    }

    @Test
    void retryWorkerUsesSchedulerAndNewTransaction() throws NoSuchMethodException {
        Method retryDueMessages = AnalysisRequestOutboxDispatcher.class.getDeclaredMethod("retryDueMessages");

        Scheduled scheduled = retryDueMessages.getAnnotation(Scheduled.class);
        Transactional transactional = retryDueMessages.getAnnotation(Transactional.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.fixedDelayString()).isEqualTo("${wedge.outbox.analysis-request.retry-fixed-delay-ms:5000}");
        assertThat(transactional).isNotNull();
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void retryDueMessagesPublishesAndMarksPublished() {
        UUID outboxMessageId = UUID.randomUUID();
        AnalysisRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueAnalysisRequestMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.AnalysisRequestOutboxMessage(
                        outboxMessageId,
                        message
                )));

        dispatcher.retryDueMessages();

        InOrder inOrder = inOrder(analysisRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findDueAnalysisRequestMessages(50);
        inOrder.verify(analysisRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void retryDueMessagesMarksFailedWhenPublishFails() {
        UUID outboxMessageId = UUID.randomUUID();
        AnalysisRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueAnalysisRequestMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.AnalysisRequestOutboxMessage(
                        outboxMessageId,
                        message
                )));
        doThrow(new IllegalStateException("broker unavailable")).when(analysisRequestPublisher).publish(message);

        dispatcher.retryDueMessages();

        verify(outboxMessagePersistenceAdapter).markFailed(outboxMessageId);
    }

    private AnalysisRequestMessage sampleMessage() {
        UUID runId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        return new AnalysisRequestMessage(
                UUID.randomUUID().toString(),
                "analysis.request",
                "0.5",
                "2026-04-30T00:00:00Z",
                "spring-api",
                runId.toString(),
                "analysis:" + analysisJobId,
                Map.of(
                        "analysisJobId", analysisJobId.toString(),
                        "runId", runId.toString(),
                        "analysisType", "PRIMARY",
                        "evidencePacketId", UUID.randomUUID().toString()
                )
        );
    }
}
