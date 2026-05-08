package com.wedge.discovery.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.util.UUID;

public record CreateDiscoveryRequest(
        UUID projectId,
        @NotNull URI url,
        @NotBlank String devicePreset,
        @Valid DiscoveryViewportRequest viewport
) {
}
