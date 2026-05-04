package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record DiscoveryFailedRequest(
        @NotBlank String eventId,
        @NotBlank String workerId,
        @NotNull OffsetDateTime failedAt,
        @NotBlank String failureCode,
        @NotBlank String failureMessage
) {
}
