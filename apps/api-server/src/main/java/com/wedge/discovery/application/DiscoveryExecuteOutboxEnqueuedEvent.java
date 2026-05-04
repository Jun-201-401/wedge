package com.wedge.discovery.application;

import java.util.UUID;

public record DiscoveryExecuteOutboxEnqueuedEvent(UUID outboxMessageId) {
}
