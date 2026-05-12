package com.wedge.scenarioauthoring.application;

import java.util.UUID;

public record ScenarioAuthoringExecuteOutboxEnqueuedEvent(UUID outboxMessageId) {
}
