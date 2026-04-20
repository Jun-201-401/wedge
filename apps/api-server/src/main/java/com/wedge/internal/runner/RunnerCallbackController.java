package com.wedge.internal.runner;

import com.wedge.common.response.ApiResponse;
import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerStepEventsRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/runner/runs/{runId}")
public class RunnerCallbackController {
    private final RunService runService;

    public RunnerCallbackController(RunService runService) {
        this.runService = runService;
    }

    @PostMapping("/accepted")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerAccepted(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerAcceptedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        callbackHeaders(workerId, eventId, signature).validateWorkerMatches(request.workerId());
        RunResponse run = runService.markAccepted(runId);
        return ApiResponse.ok(Map.of("runId", run.id(), "status", run.status()));
    }

    @PostMapping("/step-events")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerStepEvents(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerStepEventsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        RunResponse run = runService.markRunningIfStarting(runId);
        return ApiResponse.ok(Map.of("runId", run.id(), "status", run.status(), "eventCount", request.events().size()));
    }

    @PostMapping("/checkpoints")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerCheckpoints(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerCheckpointsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        runService.getRun(runId);
        return ApiResponse.accepted(Map.of("runId", runId, "checkpointCount", request.checkpoints().size()));
    }

    @PostMapping("/artifacts")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerArtifacts(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerArtifactsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        runService.getRun(runId);
        return ApiResponse.ok(Map.of("runId", runId, "artifactCount", request.artifacts().size()));
    }

    @PostMapping("/finished")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerFinished(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerFinishedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        callbackHeaders(workerId, eventId, signature).validateWorkerMatches(request.workerId());
        RunResponse run = runService.finishRun(runId, request.summary().stopped());
        return ApiResponse.ok(Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness()));
    }

    @PostMapping("/failed")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerFailed(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerFailedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        callbackHeaders(workerId, eventId, signature).validateWorkerMatches(request.workerId());
        RunResponse run = runService.failRun(runId, request.failureCode(), request.failureMessage(), request.resultCompleteness());
        return ApiResponse.ok(Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness()));
    }

    private RunnerCallbackHeaders callbackHeaders(String workerId, String eventId, String signature) {
        return new RunnerCallbackHeaders(workerId, eventId, signature);
    }
}
