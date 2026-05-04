package com.wedge.discovery.application.command;

import java.time.OffsetDateTime;

public record DiscoveryAcceptedCommand(
        String workerId,
        OffsetDateTime acceptedAt,
        String browserSessionId
) {
}
