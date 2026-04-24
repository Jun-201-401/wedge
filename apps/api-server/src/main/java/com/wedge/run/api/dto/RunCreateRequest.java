package com.wedge.run.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.util.Map;
import java.util.UUID;

public record RunCreateRequest(
        @NotNull UUID projectId,
        @NotBlank String name,
        @NotNull URI startUrl,
        String goal,
        @NotBlank String devicePreset,
        @NotNull UUID scenarioTemplateVersionId,
        Map<String, Object> scenarioOverrides,
        Map<String, Object> scenarioPlan
) {
}
