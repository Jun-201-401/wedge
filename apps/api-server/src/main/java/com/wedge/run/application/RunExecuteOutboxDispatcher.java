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
public class RunExecuteOutboxDispatcher {
    private static final Logger log = LoggerFactory.getLogger(RunExecuteOutboxDispatcher.class);
    private static final int RETRY_BATCH_SIZE = 50;

    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final RunRequestPublisher runRequestPublisher;

    public RunExecuteOutboxDispatcher(
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            RunRequestPublisher runRequestPublisher
    ) {
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.runRequestPublisher = runRequestPublisher;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(RunExecuteOutboxEnqueuedEvent event) {
        outboxMessagePersistenceAdapter.findRunnerRequestMessageForPublish(event.outboxMessageId()).ifPresent(message -> {
            dispatch(event.outboxMessageId(), message);
        });
    }

    @Scheduled(fixedDelayString = "${wedge.outbox.run-execute.retry-fixed-delay-ms:5000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void retryDueMessages() {
        outboxMessagePersistenceAdapter.findDueRunExecuteMessages(RETRY_BATCH_SIZE)
                .forEach(message -> dispatch(message.outboxMessageId(), message.runExecuteRequestMessage()));
        outboxMessagePersistenceAdapter.findDueAgentExecuteMessages(RETRY_BATCH_SIZE)
                .forEach(message -> dispatch(message.outboxMessageId(), message.runExecuteRequestMessage()));
    }

    private void dispatch(UUID outboxMessageId, RunExecuteRequestMessage message) {
        try {
            runRequestPublisher.publish(message);
            outboxMessagePersistenceAdapter.markPublished(outboxMessageId);
        } catch (RuntimeException exception) {
            log.warn(
                    "Failed to publish runner request outbox message id={} messageType={} messageId={} correlationId={} idempotencyKey={}",
                    outboxMessageId,
                    message.messageType(),
                    message.messageId(),
                    message.correlationId(),
                    message.idempotencyKey(),
                    exception
            );
            outboxMessagePersistenceAdapter.markFailed(outboxMessageId);
        }
    }
}
