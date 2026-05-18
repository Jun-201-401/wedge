package com.wedge.analysis.application;

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
public class AnalysisRequestOutboxDispatcher {
    private static final Logger log = LoggerFactory.getLogger(AnalysisRequestOutboxDispatcher.class);
    private static final int RETRY_BATCH_SIZE = 50;

    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final AnalysisRequestPublisher analysisRequestPublisher;

    public AnalysisRequestOutboxDispatcher(
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            AnalysisRequestPublisher analysisRequestPublisher
    ) {
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.analysisRequestPublisher = analysisRequestPublisher;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(AnalysisRequestOutboxEnqueuedEvent event) {
        outboxMessagePersistenceAdapter.findAnalysisRequestMessageForPublish(event.outboxMessageId())
                .ifPresent(message -> dispatch(event.outboxMessageId(), message));
    }

    @Scheduled(fixedDelayString = "${wedge.outbox.analysis-request.retry-fixed-delay-ms:5000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void retryDueMessages() {
        outboxMessagePersistenceAdapter.findDueAnalysisRequestMessages(RETRY_BATCH_SIZE)
                .forEach(message -> dispatch(message.outboxMessageId(), message.analysisRequestMessage()));
    }

    private void dispatch(UUID outboxMessageId, AnalysisRequestMessage message) {
        try {
            analysisRequestPublisher.publish(message);
            outboxMessagePersistenceAdapter.markPublished(outboxMessageId);
        } catch (RuntimeException exception) {
            log.warn(
                    "Failed to publish analysis.request outbox message id={} messageId={} correlationId={} idempotencyKey={}",
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
