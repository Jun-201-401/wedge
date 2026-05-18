package com.wedge.scenarioauthoring.application;

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
class ScenarioAuthoringExecuteOutboxDispatcherTest {
    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private ScenarioAuthoringRequestPublisher scenarioAuthoringRequestPublisher;

    private ScenarioAuthoringExecuteOutboxDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new ScenarioAuthoringExecuteOutboxDispatcher(outboxMessagePersistenceAdapter, scenarioAuthoringRequestPublisher);
    }

    @Test
    void outboxEventListenerUsesNewTransactionAfterCommit() throws NoSuchMethodException {
        Method handle = ScenarioAuthoringExecuteOutboxDispatcher.class.getDeclaredMethod(
                "handle",
                ScenarioAuthoringExecuteOutboxEnqueuedEvent.class
        );

        assertThat(handle.getAnnotation(TransactionalEventListener.class)).isNotNull();
        assertThat(handle.getAnnotation(Transactional.class).propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void handlePublishesOnlyWhenMessageCanBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        ScenarioAuthoringExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findScenarioAuthoringExecuteMessageForPublish(outboxMessageId))
                .thenReturn(Optional.of(message));

        dispatcher.handle(new ScenarioAuthoringExecuteOutboxEnqueuedEvent(outboxMessageId));

        InOrder inOrder = inOrder(scenarioAuthoringRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findScenarioAuthoringExecuteMessageForPublish(outboxMessageId);
        inOrder.verify(scenarioAuthoringRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void retryWorkerUsesSchedulerAndNewTransaction() throws NoSuchMethodException {
        Method retryDueMessages = ScenarioAuthoringExecuteOutboxDispatcher.class.getDeclaredMethod("retryDueMessages");

        Scheduled scheduled = retryDueMessages.getAnnotation(Scheduled.class);
        Transactional transactional = retryDueMessages.getAnnotation(Transactional.class);

        assertThat(scheduled.fixedDelayString()).isEqualTo("${wedge.outbox.scenario-authoring-execute.retry-fixed-delay-ms:5000}");
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void retryDueMessagesMarksFailedWithCauseWhenPublishFails() {
        UUID outboxMessageId = UUID.randomUUID();
        ScenarioAuthoringExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueScenarioAuthoringExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.ScenarioAuthoringExecuteOutboxMessage(
                        outboxMessageId,
                        message
                )));
        doThrow(new IllegalStateException("broker unavailable")).when(scenarioAuthoringRequestPublisher).publish(message);

        dispatcher.retryDueMessages();

        verify(outboxMessagePersistenceAdapter).markFailed(
                org.mockito.ArgumentMatchers.eq(outboxMessageId),
                org.mockito.ArgumentMatchers.any(IllegalStateException.class)
        );
    }

    private ScenarioAuthoringExecuteRequestMessage sampleMessage() {
        UUID authoringJobId = UUID.randomUUID();
        return new ScenarioAuthoringExecuteRequestMessage(
                UUID.randomUUID().toString(),
                "scenario-authoring.execute.request",
                "0.5",
                "2026-05-10T00:00:00Z",
                "spring-api",
                authoringJobId.toString(),
                "scenario-authoring:" + authoringJobId,
                Map.of("authoringJobId", authoringJobId.toString())
        );
    }
}
