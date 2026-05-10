package com.wedge.run.api.internal.runner;

import com.wedge.common.response.ApiResponse;
import com.wedge.run.api.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentEventsRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentTraceRequest;
import com.wedge.run.api.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.run.api.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.run.api.internal.runner.dto.RunnerFailedRequest;
import com.wedge.run.api.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.run.api.internal.runner.dto.RunnerFinishedSummary;
import com.wedge.run.api.internal.runner.dto.RunnerStepEventsRequest;
import com.wedge.run.application.RunnerCallbackAckResponse;
import com.wedge.run.application.RunnerCallbackService;
import com.wedge.run.application.command.RunnerAcceptedCommand;
import com.wedge.run.application.command.RunnerAgentEventCommand;
import com.wedge.run.application.command.RunnerAgentEventsCommand;
import com.wedge.run.application.command.RunnerAgentTraceCommand;
import com.wedge.run.application.command.RunnerArtifactCommand;
import com.wedge.run.application.command.RunnerArtifactsCommand;
import com.wedge.common.internal.InternalCallbackContext;
import com.wedge.run.application.command.RunnerCheckpointCommand;
import com.wedge.run.application.command.RunnerCheckpointsCommand;
import com.wedge.run.application.command.RunnerFailedCommand;
import com.wedge.run.application.command.RunnerFinishedCommand;
import com.wedge.run.application.command.RunnerStepEventCommand;
import com.wedge.run.application.command.RunnerStepEventsCommand;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/runner/runs/{runId}")
@RequiredArgsConstructor
public class RunnerCallbackController {
    private final RunnerCallbackService runnerCallbackService;

    @PostMapping("/accepted")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerAccepted(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerAcceptedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleAccepted(runId, toAcceptedCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/step-events")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerStepEvents(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerStepEventsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleStepEvents(runId, toStepEventsCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/checkpoints")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerCheckpoints(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerCheckpointsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.accepted(runnerCallbackService.handleCheckpoints(runId, toCheckpointsCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/artifacts")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerArtifacts(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerArtifactsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleArtifacts(runId, toArtifactsCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/finished")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerFinished(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerFinishedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleFinished(runId, toFinishedCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/failed")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerFailed(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerFailedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleFailed(runId, toFailedCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/agent-events")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerAgentEvents(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerAgentEventsRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleAgentEvents(runId, toAgentEventsCommand(request), callbackContext(workerId, eventId, signature)));
    }

    @PostMapping("/agent-traces")
    public ResponseEntity<ApiResponse<RunnerCallbackAckResponse>> handleRunnerAgentTrace(
            @PathVariable UUID runId,
            @Valid @RequestBody RunnerAgentTraceRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(runnerCallbackService.handleAgentTrace(runId, new RunnerAgentTraceCommand(request.trace()), callbackContext(workerId, eventId, signature)));
    }

    private RunnerAcceptedCommand toAcceptedCommand(RunnerAcceptedRequest request) {
        return new RunnerAcceptedCommand(request.workerId(), request.acceptedAt(), request.browserSessionId());
    }

    private RunnerStepEventsCommand toStepEventsCommand(RunnerStepEventsRequest request) {
        return new RunnerStepEventsCommand(request.events().stream()
                .map(event -> new RunnerStepEventCommand(
                        event.eventId(),
                        event.stepOrder(),
                        event.stepKey(),
                        event.eventType().name(),
                        event.occurredAt(),
                        event.payload()
                ))
                .toList());
    }

    private RunnerCheckpointsCommand toCheckpointsCommand(RunnerCheckpointsRequest request) {
        return new RunnerCheckpointsCommand(request.checkpoints().stream()
                .map(checkpoint -> new RunnerCheckpointCommand(
                        checkpoint.checkpointId(),
                        checkpoint.stepKey(),
                        checkpoint.stage().name(),
                        checkpoint.trigger(),
                        Map.of(
                                "strategy", checkpoint.settle().strategy(),
                                "durationMs", checkpoint.settle().durationMs(),
                                "status", checkpoint.settle().status().name()
                        ),
                        checkpoint.settle().durationMs(),
                        checkpoint.state(),
                        checkpoint.observations(),
                        checkpoint.deltas(),
                        checkpoint.artifactRefs()
                ))
                .toList());
    }

    private RunnerArtifactsCommand toArtifactsCommand(RunnerArtifactsRequest request) {
        return new RunnerArtifactsCommand(request.artifacts().stream()
                .map(artifact -> new RunnerArtifactCommand(
                        artifact.artifactId(),
                        artifact.stepKey(),
                        artifact.artifactType().name(),
                        artifact.bucket(),
                        artifact.key(),
                        artifact.mimeType(),
                        artifact.width(),
                        artifact.height(),
                        artifact.sizeBytes(),
                        artifact.sha256(),
                        artifact.createdAt()
                ))
                .toList());
    }

    private RunnerFinishedCommand toFinishedCommand(RunnerFinishedRequest request) {
        return new RunnerFinishedCommand(
                request.workerId(),
                request.executionFinishedAt(),
                request.summary().completedStepCount(),
                request.summary().failedStepCount(),
                request.summary().stopped()
        );
    }

    private RunnerFailedCommand toFailedCommand(RunnerFailedRequest request) {
        RunnerFinishedSummary summary = request.summary();
        return new RunnerFailedCommand(
                request.workerId(),
                request.failedAt(),
                request.failureCode(),
                request.failureMessage(),
                request.resultCompleteness(),
                summary == null ? null : summary.completedStepCount(),
                summary == null ? null : summary.failedStepCount(),
                summary == null ? null : summary.stopped()
        );
    }

    private RunnerAgentEventsCommand toAgentEventsCommand(RunnerAgentEventsRequest request) {
        return new RunnerAgentEventsCommand(request.events().stream()
                .map(event -> new RunnerAgentEventCommand(
                        event.schemaVersion(),
                        event.eventId(),
                        event.taskId(),
                        event.attemptId(),
                        event.runId(),
                        event.stepIndex(),
                        event.eventType(),
                        event.occurredAt(),
                        event.payload()
                ))
                .toList());
    }

    private InternalCallbackContext callbackContext(String workerId, String eventId, String signature) {
        return new InternalCallbackContext(workerId, eventId, signature);
    }
}
