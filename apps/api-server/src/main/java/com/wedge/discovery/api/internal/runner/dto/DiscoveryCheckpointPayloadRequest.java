package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import java.util.Map;

public record DiscoveryCheckpointPayloadRequest(
        @NotBlank String checkpointId,
        @NotBlank String stepKey,
        @NotBlank @Pattern(regexp = "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT") String stage,
        @NotNull Map<String, Object> trigger,
        @NotNull Map<String, Object> settle,
        @NotNull Map<String, Object> state,
        @NotNull List<Map<String, Object>> observations,
        @NotNull List<Map<String, Object>> deltas,
        @NotNull List<String> artifactRefs,
        @Min(0) Integer durationMs
) {
}
