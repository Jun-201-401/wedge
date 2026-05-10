package com.wedge.run.application;

import java.util.UUID;

public record AgentExecuteOutboxEnqueuedEvent(UUID outboxMessageId) {
}
