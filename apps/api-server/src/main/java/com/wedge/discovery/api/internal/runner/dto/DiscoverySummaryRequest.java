package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record DiscoverySummaryRequest(
        @NotNull List<String> detectedFlowTypes,
        @NotNull List<String> missingFlowTypes,
        @Min(0) int primaryCtaCount,
        @Min(0) int formCandidateCount,
        @Min(0) int pricingEntrypointCount,
        @Min(0) int checkoutEntrypointCount,
        @NotNull List<@Valid DiscoveryRecommendationRequest> scenarioRecommendations
) {
}
