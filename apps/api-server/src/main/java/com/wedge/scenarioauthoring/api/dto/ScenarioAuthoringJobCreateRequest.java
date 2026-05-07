package com.wedge.scenarioauthoring.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import java.util.UUID;

public record ScenarioAuthoringJobCreateRequest(
        @NotNull UUID projectId,
        @NotNull UUID sourceDiscoveryId,
        UUID selectedRecommendationId,
        @NotBlank String requestedGoal,
        String preferredScenarioType,
        Map<String, Object> selectedRecommendation,
        Map<String, Object> constraints,
        ScenarioAuthoringProviderPolicyRequest providerPolicy
) {
}
