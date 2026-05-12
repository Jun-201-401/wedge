package com.wedge.scenarioauthoring.application;

import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import java.util.UUID;

public record ScenarioAuthoringCallbackAckResponse(
        UUID authoringJobId,
        ScenarioAuthoringStatus status,
        Integer candidateCount,
        Boolean duplicate
) {
    public static ScenarioAuthoringCallbackAckResponse status(UUID authoringJobId, ScenarioAuthoringStatus status) {
        return new ScenarioAuthoringCallbackAckResponse(authoringJobId, status, null, null);
    }

    public static ScenarioAuthoringCallbackAckResponse finished(UUID authoringJobId, ScenarioAuthoringStatus status, int candidateCount) {
        return new ScenarioAuthoringCallbackAckResponse(authoringJobId, status, candidateCount, null);
    }

    public static ScenarioAuthoringCallbackAckResponse duplicate(UUID authoringJobId, ScenarioAuthoringStatus status) {
        return new ScenarioAuthoringCallbackAckResponse(authoringJobId, status, null, true);
    }
}
