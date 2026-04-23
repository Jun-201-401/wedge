package com.wedge.internal.runner;

import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerStepEventsRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class RunnerCallbackService {
    private final RunService runService;

    public RunnerCallbackService(RunService runService) {
        this.runService = runService;
    }

    public Map<String, Object> handleAccepted(UUID runId, RunnerAcceptedRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        headers.validateWorkerMatches(request.workerId());
        RunResponse run = runService.markAccepted(runId);
        return Map.of("runId", run.id(), "status", run.status());
    }

    public Map<String, Object> handleStepEvents(UUID runId, RunnerStepEventsRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        RunResponse run = runService.markRunningIfStarting(runId);
        return Map.of("runId", run.id(), "status", run.status(), "eventCount", request.events().size());
    }

    public Map<String, Object> handleCheckpoints(UUID runId, RunnerCheckpointsRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        runService.getRun(runId);
        return Map.of("runId", runId, "checkpointCount", request.checkpoints().size());
    }

    public Map<String, Object> handleArtifacts(UUID runId, RunnerArtifactsRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        runService.getRun(runId);
        return Map.of("runId", runId, "artifactCount", request.artifacts().size());
    }

    public Map<String, Object> handleFinished(UUID runId, RunnerFinishedRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        headers.validateWorkerMatches(request.workerId());
        RunResponse run = runService.finishRun(runId, request.summary().stopped());
        return Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness());
    }

    public Map<String, Object> handleFailed(UUID runId, RunnerFailedRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        headers.validateWorkerMatches(request.workerId());
        RunResponse run = runService.failRun(runId, request.failureCode(), request.failureMessage(), request.resultCompleteness());
        return Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness());
    }
}
