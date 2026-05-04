package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.OffsetDateTime;

public record DiscoveryFinishedRequest(
        @NotBlank String eventId,
        @NotBlank String workerId,
        @NotNull OffsetDateTime finishedAt,
        @NotNull URI finalUrl,
        @Valid @NotNull DiscoverySummaryRequest summary
) {
}
