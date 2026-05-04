package com.wedge.discovery.api.dto;

import java.math.BigDecimal;
import java.net.URI;
import java.util.List;
import java.util.Map;

public record ScenarioRecommendationResponse(
        String scenarioType,
        String recommendationLevel,
        BigDecimal confidence,
        String reason,
        List<String> evidenceRefs,
        URI suggestedStartUrl,
        Map<String, Object> suggestedTarget
) {
}
