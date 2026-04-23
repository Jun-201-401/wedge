package com.wedge.internal.runner;

import com.wedge.common.response.ApiResponse;
import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerStepEventsRequest;
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
    private final RunnerCallbackService runnerCallbackService;

    public RunnerCallbackController(RunnerCallbackService runnerCallbackService) {
        this.runnerCallbackService = runnerCallbackService;
    }

    @PostMapping("/accepted")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerAccepted(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerAcceptedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleAccepted(runId, request, callbackHeaders(workerId, eventId, signature)));
    }

    @PostMapping("/step-events")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerStepEvents(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerStepEventsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleStepEvents(runId, request, callbackHeaders(workerId, eventId, signature)));
    }

    @PostMapping("/checkpoints")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerCheckpoints(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerCheckpointsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.accepted(runnerCallbackService.handleCheckpoints(runId, request, callbackHeaders(workerId, eventId, signature)));
    }

    @PostMapping("/artifacts")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerArtifacts(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerArtifactsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleArtifacts(runId, request, callbackHeaders(workerId, eventId, signature)));
    }

    @PostMapping("/finished")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerFinished(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerFinishedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleFinished(runId, request, callbackHeaders(workerId, eventId, signature)));
    }

    @PostMapping("/failed")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRunnerFailed(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerFailedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleFailed(runId, request, callbackHeaders(workerId, eventId, signature)));
    }

    private RunnerCallbackHeaders callbackHeaders(String workerId, String eventId, String signature) {
        return new RunnerCallbackHeaders(workerId, eventId, signature);
    }
}
