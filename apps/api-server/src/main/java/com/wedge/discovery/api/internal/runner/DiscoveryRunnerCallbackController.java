package com.wedge.discovery.api.internal.runner;

import com.wedge.common.internal.InternalCallbackContext;
import com.wedge.common.response.ApiResponse;
import com.wedge.discovery.api.internal.runner.dto.DiscoveryAcceptedRequest;
import com.wedge.discovery.api.internal.runner.dto.DiscoveryCheckpointPayloadRequest;
import com.wedge.discovery.api.internal.runner.dto.DiscoveryCheckpointRequest;
import com.wedge.discovery.api.internal.runner.dto.DiscoveryFailedRequest;
import com.wedge.discovery.api.internal.runner.dto.DiscoveryFinishedRequest;
import com.wedge.discovery.api.internal.runner.dto.DiscoveryRecommendationRequest;
import com.wedge.discovery.api.internal.runner.dto.DiscoverySummaryRequest;
import com.wedge.discovery.application.DiscoveryCallbackAckResponse;
import com.wedge.discovery.application.DiscoveryCallbackService;
import com.wedge.discovery.application.command.DiscoveryAcceptedCommand;
import com.wedge.discovery.application.command.DiscoveryFailedCommand;
import com.wedge.discovery.application.command.DiscoveryFinishedCommand;
import com.wedge.discovery.application.command.DiscoveryRecommendationCommand;
import com.wedge.discovery.application.command.DiscoverySummaryCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.List;
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
@RequestMapping("/internal/runner/discoveries/{discoveryId}")
@RequiredArgsConstructor
public class DiscoveryRunnerCallbackController {
    private static final String DURATION_MS_FIELD = "durationMs";

    private final DiscoveryCallbackService discoveryCallbackService;

    @PostMapping("/accepted")
    public ResponseEntity<ApiResponse<DiscoveryCallbackAckResponse>> handleDiscoveryAccepted(
            @PathVariable UUID discoveryId,
            @Valid @RequestBody DiscoveryAcceptedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(discoveryCallbackService.handleAccepted(
                discoveryId,
                toAcceptedCommand(request),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    @PostMapping("/checkpoints")
    public ResponseEntity<ApiResponse<DiscoveryCallbackAckResponse>> handleDiscoveryCheckpoint(
            @PathVariable UUID discoveryId,
            @Valid @RequestBody DiscoveryCheckpointRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.accepted(discoveryCallbackService.handleCheckpoints(
                discoveryId,
                request.workerId(),
                toSaveRunCheckpointsCommand(request),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    @PostMapping("/finished")
    public ResponseEntity<ApiResponse<DiscoveryCallbackAckResponse>> handleDiscoveryFinished(
            @PathVariable UUID discoveryId,
            @Valid @RequestBody DiscoveryFinishedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(discoveryCallbackService.handleFinished(
                discoveryId,
                toFinishedCommand(request),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    @PostMapping("/failed")
    public ResponseEntity<ApiResponse<DiscoveryCallbackAckResponse>> handleDiscoveryFailed(
            @PathVariable UUID discoveryId,
            @Valid @RequestBody DiscoveryFailedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(discoveryCallbackService.handleFailed(
                discoveryId,
                toFailedCommand(request),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    private DiscoveryAcceptedCommand toAcceptedCommand(DiscoveryAcceptedRequest request) {
        return new DiscoveryAcceptedCommand(request.workerId(), request.acceptedAt(), request.browserSessionId());
    }

    private DiscoveryFinishedCommand toFinishedCommand(DiscoveryFinishedRequest request) {
        return new DiscoveryFinishedCommand(
                request.workerId(),
                request.finishedAt(),
                request.finalUrl().toString(),
                toSummaryCommand(request.summary())
        );
    }

    private DiscoveryFailedCommand toFailedCommand(DiscoveryFailedRequest request) {
        return new DiscoveryFailedCommand(request.workerId(), request.failedAt(), request.failureCode(), request.failureMessage());
    }

    private SaveRunCheckpointsCommand toSaveRunCheckpointsCommand(DiscoveryCheckpointRequest request) {
        return new SaveRunCheckpointsCommand(List.of(toSaveRunCheckpointCommand(
                request.checkpoint(),
                request.observations()
        )));
    }

    private SaveRunCheckpointCommand toSaveRunCheckpointCommand(
            DiscoveryCheckpointPayloadRequest checkpoint,
            List<Map<String, Object>> topLevelObservations
    ) {
        List<Map<String, Object>> observations = combinedObservations(checkpoint, topLevelObservations);
        int durationMs = checkpoint.durationMs() == null ? readDurationMs(checkpoint.settle()) : checkpoint.durationMs();
        return new SaveRunCheckpointCommand(
                checkpoint.checkpointId(),
                checkpoint.stepKey(),
                checkpoint.stage(),
                checkpoint.trigger(),
                checkpoint.settle(),
                durationMs,
                checkpoint.state(),
                observations,
                checkpoint.deltas(),
                checkpoint.artifactRefs()
        );
    }

    private List<Map<String, Object>> combinedObservations(
            DiscoveryCheckpointPayloadRequest checkpoint,
            List<Map<String, Object>> topLevelObservations
    ) {
        List<Map<String, Object>> observations = new ArrayList<>(checkpoint.observations());
        observations.addAll(topLevelObservations);
        return observations;
    }

    private int readDurationMs(Map<String, Object> settle) {
        Object value = settle.get(DURATION_MS_FIELD);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return 0;
    }

    private DiscoverySummaryCommand toSummaryCommand(DiscoverySummaryRequest request) {
        return new DiscoverySummaryCommand(
                request.detectedFlowTypes(),
                request.missingFlowTypes(),
                request.primaryCtaCount(),
                request.formCandidateCount(),
                request.pricingEntrypointCount(),
                request.checkoutEntrypointCount(),
                request.scenarioRecommendations().stream().map(this::toRecommendationCommand).toList()
        );
    }

    private DiscoveryRecommendationCommand toRecommendationCommand(DiscoveryRecommendationRequest request) {
        return new DiscoveryRecommendationCommand(
                request.scenarioType(),
                request.recommendationLevel(),
                request.confidence(),
                request.reason(),
                request.evidenceRefs(),
                request.suggestedStartUrl() == null ? null : request.suggestedStartUrl().toString(),
                request.suggestedTarget()
        );
    }

    private InternalCallbackContext callbackContext(String workerId, String eventId, String signature, String bodyEventId) {
        InternalCallbackContext context = new InternalCallbackContext(workerId, eventId, signature);
        context.validateEventMatches(bodyEventId);
        return context;
    }
}
