package com.wedge.run.application;

import java.net.URI;
import java.util.Map;
import java.util.UUID;

public record RunExecutionRequestSource(
        UUID id,
        UUID projectId,
        String triggerSource,
        URI startUrl,
        String goal,
        String devicePreset,
        UUID scenarioTemplateVersionId,
        Map<String, Object> scenarioPlan,
        Map<String, Object> scenarioOverrides
) {
    public RunExecutionRequestSource(
            UUID id,
            UUID projectId,
            String triggerSource,
            URI startUrl,
            String goal,
            String devicePreset,
            UUID scenarioTemplateVersionId,
            Map<String, Object> scenarioPlan
    ) {
        this(id, projectId, triggerSource, startUrl, goal, devicePreset, scenarioTemplateVersionId, scenarioPlan, Map.of());
    }
}
