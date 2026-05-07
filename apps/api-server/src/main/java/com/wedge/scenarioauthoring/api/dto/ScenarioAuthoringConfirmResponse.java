package com.wedge.scenarioauthoring.api.dto;

import java.util.Map;

public record ScenarioAuthoringConfirmResponse(
        ScenarioAuthoringJobResponse authoringJob,
        Map<String, Object> confirmedCandidate
) {
}
