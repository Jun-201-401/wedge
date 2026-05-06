package com.wedge.scenarioauthoring.api.dto;

import jakarta.validation.constraints.NotBlank;

public record ScenarioAuthoringConfirmRequest(
        @NotBlank String candidateId
) {
}
