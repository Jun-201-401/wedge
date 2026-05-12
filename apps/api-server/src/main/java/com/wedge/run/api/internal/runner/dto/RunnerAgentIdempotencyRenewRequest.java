package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record RunnerAgentIdempotencyRenewRequest(
        @NotNull UUID runId,
        @NotBlank String taskId,
        @NotBlank String attemptId,
        @NotNull @Min(1) Integer attemptIndex,
        @Min(1_000) @Max(86_400_000) Long leaseTtlMs
) {
    public long normalizedLeaseTtlMs() {
        return leaseTtlMs == null ? 300_000L : leaseTtlMs;
    }
}
