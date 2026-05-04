package com.wedge.discovery.application.command;

import java.time.OffsetDateTime;

public record DiscoveryFailedCommand(
        String workerId,
        OffsetDateTime failedAt,
        String failureCode,
        String failureMessage
) {
}
