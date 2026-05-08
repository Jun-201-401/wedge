package com.wedge.run.application;

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
class RunExecuteOutboxDispatcherTest {
    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private RunRequestPublisher runRequestPublisher;

    private RunExecuteOutboxDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new RunExecuteOutboxDispatcher(outboxMessagePersistenceAdapter, runRequestPublisher);
    }

    @Test
    void outboxEventListenerUsesNewTransactionAfterCommit() throws NoSuchMethodException {
        Method handle = RunExecuteOutboxDispatcher.class.getDeclaredMethod(
                "handle",
                RunExecuteOutboxEnqueuedEvent.class
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
        RunExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findRunnerRequestMessageForPublish(outboxMessageId))
                .thenReturn(Optional.of(message));

        dispatcher.handle(new RunExecuteOutboxEnqueuedEvent(outboxMessageId));

        InOrder inOrder = inOrder(runRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findRunnerRequestMessageForPublish(outboxMessageId);
        inOrder.verify(runRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void handleSkipsPublishWhenMessageCannotBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        when(outboxMessagePersistenceAdapter.findRunnerRequestMessageForPublish(outboxMessageId))
                .thenReturn(Optional.empty());

        dispatcher.handle(new RunExecuteOutboxEnqueuedEvent(outboxMessageId));

        verifyNoInteractions(runRequestPublisher);
    }

    @Test
    void retryWorkerUsesSchedulerAndNewTransaction() throws NoSuchMethodException {
        Method retryDueMessages = RunExecuteOutboxDispatcher.class.getDeclaredMethod("retryDueMessages");

        Scheduled scheduled = retryDueMessages.getAnnotation(Scheduled.class);
        Transactional transactional = retryDueMessages.getAnnotation(Transactional.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.fixedDelayString()).isEqualTo("${wedge.outbox.run-execute.retry-fixed-delay-ms:5000}");
        assertThat(transactional).isNotNull();
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void retryDueMessagesPublishesAndMarksPublished() {
        UUID outboxMessageId = UUID.randomUUID();
        RunExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueRunExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.RunExecuteOutboxMessage(
                        outboxMessageId,
                        message
                )));
        when(outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(50)).thenReturn(List.of());

        dispatcher.retryDueMessages();

        InOrder inOrder = inOrder(runRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findDueRunExecuteMessages(50);
        inOrder.verify(runRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void retryDueMessagesAlsoPublishesAgentExecuteMessages() {
        UUID outboxMessageId = UUID.randomUUID();
        RunExecuteRequestMessage message = new RunExecuteRequestMessage(
                UUID.randomUUID().toString(),
                "agent.execute.request",
                "0.1",
                "2026-05-08T00:00:00Z",
                "spring-api",
                UUID.randomUUID().toString(),
                "agent:" + UUID.randomUUID(),
                Map.of("agentTask", Map.of("run_id", UUID.randomUUID().toString()))
        );
        when(outboxMessagePersistenceAdapter.findDueRunExecuteMessages(50)).thenReturn(List.of());
        when(outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.RunExecuteOutboxMessage(outboxMessageId, message)));

        dispatcher.retryDueMessages();

        verify(runRequestPublisher).publish(message);
        verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void retryDueMessagesMarksFailedWhenPublishFails() {
        UUID outboxMessageId = UUID.randomUUID();
        RunExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueRunExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.RunExecuteOutboxMessage(
                        outboxMessageId,
                        message
                )));
        when(outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(50)).thenReturn(List.of());
        doThrow(new IllegalStateException("broker unavailable")).when(runRequestPublisher).publish(message);

        dispatcher.retryDueMessages();

        verify(outboxMessagePersistenceAdapter).markFailed(outboxMessageId);
    }

    private RunExecuteRequestMessage sampleMessage() {
        return new RunExecuteRequestMessage(
                UUID.randomUUID().toString(),
                "run.execute.request",
                "0.5",
                "2026-04-29T00:00:00Z",
                "spring-api",
                UUID.randomUUID().toString(),
                "run:" + UUID.randomUUID(),
                Map.of("runId", UUID.randomUUID().toString())
        );
    }
}
