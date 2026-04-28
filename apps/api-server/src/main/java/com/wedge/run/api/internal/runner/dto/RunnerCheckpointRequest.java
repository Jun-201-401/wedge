package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

public record RunnerCheckpointRequest(
        @NotBlank String checkpointId,
        @NotBlank String stepKey,
        @NotNull RunnerCheckpointStage stage,
        @NotNull Map<String, Object> trigger,
        @Valid @NotNull RunnerSettleInfo settle,
        @NotNull Map<String, Object> state,
        @NotNull List<Map<String, Object>> observations,
        @NotNull List<Map<String, Object>> deltas,
        @NotNull List<String> artifactRefs
) {
}
