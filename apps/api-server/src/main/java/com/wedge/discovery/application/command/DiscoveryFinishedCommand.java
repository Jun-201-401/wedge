package com.wedge.discovery.application.command;

import java.time.OffsetDateTime;

public record DiscoveryFinishedCommand(
        String workerId,
        OffsetDateTime finishedAt,
        String finalUrl,
        DiscoverySummaryCommand summary
) {
}
