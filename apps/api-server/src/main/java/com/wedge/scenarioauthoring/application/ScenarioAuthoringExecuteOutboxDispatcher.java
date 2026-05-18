package com.wedge.scenarioauthoring.application;

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
public class ScenarioAuthoringExecuteOutboxDispatcher {
    private static final Logger log = LoggerFactory.getLogger(ScenarioAuthoringExecuteOutboxDispatcher.class);
    private static final int RETRY_BATCH_SIZE = 50;

    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final ScenarioAuthoringRequestPublisher scenarioAuthoringRequestPublisher;

    public ScenarioAuthoringExecuteOutboxDispatcher(
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            ScenarioAuthoringRequestPublisher scenarioAuthoringRequestPublisher
    ) {
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.scenarioAuthoringRequestPublisher = scenarioAuthoringRequestPublisher;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(ScenarioAuthoringExecuteOutboxEnqueuedEvent event) {
        outboxMessagePersistenceAdapter.findScenarioAuthoringExecuteMessageForPublish(event.outboxMessageId()).ifPresent(message -> dispatch(event.outboxMessageId(), message));
    }

    @Scheduled(fixedDelayString = "${wedge.outbox.scenario-authoring-execute.retry-fixed-delay-ms:5000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void retryDueMessages() {
        outboxMessagePersistenceAdapter.findDueScenarioAuthoringExecuteMessages(RETRY_BATCH_SIZE)
                .forEach(message -> dispatch(message.outboxMessageId(), message.scenarioAuthoringExecuteRequestMessage()));
    }

    private void dispatch(UUID outboxMessageId, ScenarioAuthoringExecuteRequestMessage message) {
        try {
            scenarioAuthoringRequestPublisher.publish(message);
            outboxMessagePersistenceAdapter.markPublished(outboxMessageId);
        } catch (RuntimeException exception) {
            log.warn(
                    "Failed to publish scenario-authoring.execute.request outbox message id={} messageId={} correlationId={} idempotencyKey={}",
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
