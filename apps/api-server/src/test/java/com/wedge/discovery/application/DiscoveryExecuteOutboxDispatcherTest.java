package com.wedge.discovery.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
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
class DiscoveryExecuteOutboxDispatcherTest {
    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private DiscoveryRequestPublisher discoveryRequestPublisher;

    private DiscoveryExecuteOutboxDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new DiscoveryExecuteOutboxDispatcher(outboxMessagePersistenceAdapter, discoveryRequestPublisher);
    }

    @Test
    void outboxEventListenerUsesNewTransactionAfterCommit() throws NoSuchMethodException {
        Method handle = DiscoveryExecuteOutboxDispatcher.class.getDeclaredMethod(
                "handle",
                DiscoveryExecuteOutboxEnqueuedEvent.class
        );

        assertThat(handle.getAnnotation(TransactionalEventListener.class)).isNotNull();
        assertThat(handle.getAnnotation(Transactional.class).propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void handlePublishesOnlyWhenMessageCanBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        DiscoveryExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDiscoveryExecuteMessageForPublish(outboxMessageId))
                .thenReturn(Optional.of(message));

        dispatcher.handle(new DiscoveryExecuteOutboxEnqueuedEvent(outboxMessageId));

        InOrder inOrder = inOrder(discoveryRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findDiscoveryExecuteMessageForPublish(outboxMessageId);
        inOrder.verify(discoveryRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void retryWorkerUsesSchedulerAndNewTransaction() throws NoSuchMethodException {
        Method retryDueMessages = DiscoveryExecuteOutboxDispatcher.class.getDeclaredMethod("retryDueMessages");

        Scheduled scheduled = retryDueMessages.getAnnotation(Scheduled.class);
        Transactional transactional = retryDueMessages.getAnnotation(Transactional.class);

        assertThat(scheduled.fixedDelayString()).isEqualTo("${wedge.outbox.discovery-execute.retry-fixed-delay-ms:5000}");
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void retryDueMessagesMarksFailedWithCauseWhenPublishFails() {
        UUID outboxMessageId = UUID.randomUUID();
        DiscoveryExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueDiscoveryExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.DiscoveryExecuteOutboxMessage(
                        outboxMessageId,
                        message
                )));
        doThrow(new IllegalStateException("broker unavailable")).when(discoveryRequestPublisher).publish(message);

        dispatcher.retryDueMessages();

        verify(outboxMessagePersistenceAdapter).markFailed(
                org.mockito.ArgumentMatchers.eq(outboxMessageId),
                org.mockito.ArgumentMatchers.any(IllegalStateException.class)
        );
    }

    private DiscoveryExecuteRequestMessage sampleMessage() {
        UUID discoveryId = UUID.randomUUID();
        return new DiscoveryExecuteRequestMessage(
                UUID.randomUUID().toString(),
                "discovery.execute.request",
                "0.5",
                "2026-05-10T00:00:00Z",
                "spring-api",
                discoveryId.toString(),
                "discovery:" + discoveryId,
                Map.of("discoveryId", discoveryId.toString())
        );
    }
}
