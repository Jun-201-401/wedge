package com.wedge.analysis.application;

import java.util.UUID;

public record AnalysisRequestOutboxEnqueuedEvent(UUID outboxMessageId) {
}
