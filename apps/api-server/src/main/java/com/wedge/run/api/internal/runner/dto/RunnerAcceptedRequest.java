package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record RunnerAcceptedRequest(
        @NotBlank String workerId,
        @NotNull OffsetDateTime acceptedAt,
        @NotBlank String browserSessionId
) {
}
