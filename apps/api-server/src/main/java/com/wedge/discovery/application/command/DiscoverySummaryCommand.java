package com.wedge.discovery.application.command;

import java.util.List;

public record DiscoverySummaryCommand(
        List<String> detectedFlowTypes,
        List<String> missingFlowTypes,
        int primaryCtaCount,
        int formCandidateCount,
        int pricingEntrypointCount,
        int checkoutEntrypointCount,
        List<DiscoveryRecommendationCommand> scenarioRecommendations
) {
}
