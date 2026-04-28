package com.wedge.run.application;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record RunnerCallbackAckResponse(
        UUID runId,
        RunStatus status,
        ResultCompleteness resultCompleteness,
        Integer eventCount,
        Integer checkpointCount,
        Integer artifactCount,
        Boolean duplicate
) {
    public static RunnerCallbackAckResponse accepted(RunResponse run) {
        return new RunnerCallbackAckResponse(run.id(), run.status(), null, null, null, null, null);
    }

    public static RunnerCallbackAckResponse stepEvents(RunResponse run, int eventCount) {
        return new RunnerCallbackAckResponse(run.id(), run.status(), null, eventCount, null, null, null);
    }

    public static RunnerCallbackAckResponse checkpoints(UUID runId, int checkpointCount) {
        return new RunnerCallbackAckResponse(runId, null, null, null, checkpointCount, null, null);
    }

    public static RunnerCallbackAckResponse artifacts(UUID runId, int artifactCount) {
        return new RunnerCallbackAckResponse(runId, null, null, null, null, artifactCount, null);
    }

    public static RunnerCallbackAckResponse terminal(RunResponse run) {
        return new RunnerCallbackAckResponse(run.id(), run.status(), run.resultCompleteness(), null, null, null, null);
    }

    public static RunnerCallbackAckResponse duplicateStatus(RunResponse run) {
        return new RunnerCallbackAckResponse(run.id(), run.status(), run.resultCompleteness(), null, null, null, true);
    }

    public RunnerCallbackAckResponse withEventCount(int eventCount) {
        return new RunnerCallbackAckResponse(runId, status, null, eventCount, null, null, true);
    }

    public static RunnerCallbackAckResponse duplicateCheckpoints(UUID runId, int checkpointCount) {
        return new RunnerCallbackAckResponse(runId, null, null, null, checkpointCount, null, true);
    }

    public static RunnerCallbackAckResponse duplicateArtifacts(UUID runId, int artifactCount) {
        return new RunnerCallbackAckResponse(runId, null, null, null, null, artifactCount, true);
    }
}
