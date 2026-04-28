package com.wedge.run.api.internal.runner.dto;

import com.wedge.run.domain.ResultCompleteness;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

public record RunnerFailedRequest(
        @NotBlank String workerId,
        @NotNull OffsetDateTime failedAt,
        @NotBlank String failureCode,
        @NotBlank String failureMessage,
        @NotNull ResultCompleteness resultCompleteness
) {
}
