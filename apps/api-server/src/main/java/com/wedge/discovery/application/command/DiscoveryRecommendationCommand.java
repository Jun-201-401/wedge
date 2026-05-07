package com.wedge.discovery.application.command;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public record DiscoveryRecommendationCommand(
        String scenarioType,
        String recommendationLevel,
        BigDecimal confidence,
        String reason,
        List<String> evidenceRefs,
        Map<String, Object> evidenceSummary,
        String suggestedStartUrl,
        Map<String, Object> suggestedTarget
) {
}
