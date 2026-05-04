package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

public record DiscoveryCheckpointRequest(
        @NotBlank String eventId,
        @NotBlank String workerId,
        @Valid @NotNull DiscoveryCheckpointPayloadRequest checkpoint,
        @NotNull List<Map<String, Object>> artifacts,
        @NotNull List<Map<String, Object>> observations
) {
}
