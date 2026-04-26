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
        Map<String, Object> scenarioPlan
) {
}
