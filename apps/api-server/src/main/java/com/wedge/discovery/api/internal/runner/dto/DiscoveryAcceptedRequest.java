package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record DiscoveryAcceptedRequest(
        @NotBlank String eventId,
        @NotBlank String workerId,
        @NotNull OffsetDateTime acceptedAt,
        @NotBlank String browserSessionId
) {
}
