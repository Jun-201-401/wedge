package com.wedge.run.application;

import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class AgentExecuteOutboxDispatcher {
    private static final Logger log = LoggerFactory.getLogger(AgentExecuteOutboxDispatcher.class);
    private static final int RETRY_BATCH_SIZE = 50;

    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final AgentRequestPublisher agentRequestPublisher;

    public AgentExecuteOutboxDispatcher(
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            AgentRequestPublisher agentRequestPublisher
    ) {
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.agentRequestPublisher = agentRequestPublisher;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(AgentExecuteOutboxEnqueuedEvent event) {
        outboxMessagePersistenceAdapter.findAgentExecuteMessageForPublish(event.outboxMessageId()).ifPresent(message -> {
            dispatch(event.outboxMessageId(), message);
        });
    }

    @Scheduled(fixedDelayString = "${wedge.outbox.agent-execute.retry-fixed-delay-ms:5000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void retryDueMessages() {
        outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(RETRY_BATCH_SIZE)
                .forEach(message -> dispatch(message.outboxMessageId(), message.agentExecuteRequestMessage()));
    }

    private void dispatch(UUID outboxMessageId, AgentExecuteRequestMessage message) {
        try {
            agentRequestPublisher.publish(message);
            outboxMessagePersistenceAdapter.markPublished(outboxMessageId);
        } catch (RuntimeException exception) {
            log.warn(
                    "Failed to publish agent.execute.request outbox message id={} messageId={} correlationId={} idempotencyKey={}",
                    outboxMessageId,
                    message.messageId(),
                    message.correlationId(),
                    message.idempotencyKey(),
                    exception
            );
            outboxMessagePersistenceAdapter.markFailed(outboxMessageId, exception);
        }
    }
}
