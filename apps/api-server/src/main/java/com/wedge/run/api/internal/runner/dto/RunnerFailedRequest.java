package com.wedge.run.api.internal.runner.dto;

import com.wedge.run.domain.ResultCompleteness;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.List;

public record RunnerFailedRequest(
        @NotBlank String workerId,
        @NotNull OffsetDateTime failedAt,
        @NotBlank String failureCode,
        @NotBlank String failureMessage,
        @NotNull ResultCompleteness resultCompleteness,
        @Valid RunnerFinishedSummary summary,
        String failedStepKey,
        Integer failedStepOrder,
        String lastCheckpointId,
        List<@NotBlank String> failureArtifactRefs
) {
}
