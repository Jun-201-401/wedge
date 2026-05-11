package com.wedge.discovery.api.dto;

import com.wedge.discovery.domain.DiscoveryStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record DiscoveryResponse(
        UUID discoveryId,
        UUID projectId,
        DiscoveryStatus status,
        URI inputUrl,
        URI finalUrl,
        DiscoverySummaryResponse summary,
        List<ScenarioRecommendationResponse> scenarioRecommendations,
        OffsetDateTime createdAt,
        OffsetDateTime completedAt,
        String failureCode,
        String failureMessage
) {
}
