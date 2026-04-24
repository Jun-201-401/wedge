package com.wedge.run.application;

import com.wedge.run.infrastructure.OutboxMessagePersistenceAdapter;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class RunExecuteOutboxDispatcher {
    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final RunRequestPublisher runRequestPublisher;

    public RunExecuteOutboxDispatcher(
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            RunRequestPublisher runRequestPublisher
    ) {
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.runRequestPublisher = runRequestPublisher;
    }

    @Transactional
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(RunExecuteOutboxEnqueuedEvent event) {
        outboxMessagePersistenceAdapter.findRunExecuteMessage(event.outboxMessageId()).ifPresent(message -> {
            try {
                runRequestPublisher.publish(message);
                outboxMessagePersistenceAdapter.markPublished(event.outboxMessageId());
            } catch (RuntimeException exception) {
                outboxMessagePersistenceAdapter.markFailed(event.outboxMessageId());
            }
        });
    }
}
