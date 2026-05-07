package com.wedge.scenarioauthoring.api.dto;

import java.util.List;

public record ScenarioAuthoringProviderPolicyRequest(
        List<String> providerOrder,
        Integer timeoutMs,
        Boolean fallbackAllowed,
        Boolean approvalRequired
) {
}
