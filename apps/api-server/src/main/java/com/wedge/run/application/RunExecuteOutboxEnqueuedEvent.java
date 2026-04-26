package com.wedge.run.application;

import java.util.UUID;

public record RunExecuteOutboxEnqueuedEvent(UUID outboxMessageId) {
}
