package com.wedge.run.application;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
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

@ExtendWith(MockitoExtension.class)
class AgentExecuteOutboxDispatcherTest {
    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private AgentRequestPublisher agentRequestPublisher;

    private AgentExecuteOutboxDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new AgentExecuteOutboxDispatcher(outboxMessagePersistenceAdapter, agentRequestPublisher);
    }

    @Test
    void handlePublishesOnlyWhenMessageCanBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        AgentExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findAgentExecuteMessageForPublish(outboxMessageId))
                .thenReturn(Optional.of(message));

        dispatcher.handle(new AgentExecuteOutboxEnqueuedEvent(outboxMessageId));

        InOrder inOrder = inOrder(agentRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findAgentExecuteMessageForPublish(outboxMessageId);
        inOrder.verify(agentRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void handleSkipsPublishWhenMessageCannotBeClaimed() {
        UUID outboxMessageId = UUID.randomUUID();
        when(outboxMessagePersistenceAdapter.findAgentExecuteMessageForPublish(outboxMessageId))
                .thenReturn(Optional.empty());

        dispatcher.handle(new AgentExecuteOutboxEnqueuedEvent(outboxMessageId));

        verifyNoInteractions(agentRequestPublisher);
    }

    @Test
    void retryDueMessagesPublishesAndMarksPublished() {
        UUID outboxMessageId = UUID.randomUUID();
        AgentExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.AgentExecuteOutboxMessage(
                        outboxMessageId,
                        message
                )));

        dispatcher.retryDueMessages();

        InOrder inOrder = inOrder(agentRequestPublisher, outboxMessagePersistenceAdapter);
        inOrder.verify(outboxMessagePersistenceAdapter).findDueAgentExecuteMessages(50);
        inOrder.verify(agentRequestPublisher).publish(message);
        inOrder.verify(outboxMessagePersistenceAdapter).markPublished(outboxMessageId);
    }

    @Test
    void retryDueMessagesMarksFailedWhenPublishFails() {
        UUID outboxMessageId = UUID.randomUUID();
        AgentExecuteRequestMessage message = sampleMessage();
        when(outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(50))
                .thenReturn(List.of(new OutboxMessagePersistenceAdapter.AgentExecuteOutboxMessage(
                        outboxMessageId,
                        message
                )));
        doThrow(new IllegalStateException("broker unavailable")).when(agentRequestPublisher).publish(message);

        dispatcher.retryDueMessages();

        verify(outboxMessagePersistenceAdapter).markFailed(outboxMessageId);
    }

    private AgentExecuteRequestMessage sampleMessage() {
        UUID runId = UUID.randomUUID();
        return new AgentExecuteRequestMessage(
                UUID.randomUUID().toString(),
                "agent.execute.request",
                "0.1",
                "2026-05-10T00:00:00Z",
                "spring-api",
                runId.toString(),
                "agent:run:" + runId + ":attempt:1",
                Map.of("agentTask", Map.of("run_id", runId.toString()))
        );
    }
}
