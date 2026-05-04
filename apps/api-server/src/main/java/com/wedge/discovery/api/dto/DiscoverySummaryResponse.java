package com.wedge.discovery.api.dto;

import java.util.List;

public record DiscoverySummaryResponse(
        List<String> detectedFlowTypes,
        List<String> missingFlowTypes,
        int primaryCtaCount,
        int formCandidateCount,
        int pricingEntrypointCount,
        int checkoutEntrypointCount
) {
    public static DiscoverySummaryResponse empty() {
        return new DiscoverySummaryResponse(List.of(), List.of(), 0, 0, 0, 0);
    }
}
