package com.wedge.discovery.api.dto;

import jakarta.validation.constraints.Min;

public record DiscoveryViewportRequest(
        @Min(320) int width,
        @Min(480) int height
) {
}
