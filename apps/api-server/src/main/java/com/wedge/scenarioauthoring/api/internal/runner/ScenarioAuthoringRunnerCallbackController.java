package com.wedge.scenarioauthoring.api.internal.runner;

import com.wedge.common.internal.InternalCallbackContext;
import com.wedge.common.response.ApiResponse;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringCallbackAckResponse;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringCallbackService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
@RequestMapping("/internal/runner/scenario-authoring-jobs/{authoringJobId}")
@RequiredArgsConstructor
public class ScenarioAuthoringRunnerCallbackController {
    private final ScenarioAuthoringCallbackService scenarioAuthoringCallbackService;

    @PostMapping("/accepted")
    public ResponseEntity<ApiResponse<ScenarioAuthoringCallbackAckResponse>> handleAccepted(
            @PathVariable UUID authoringJobId,
            @Valid @RequestBody ScenarioAuthoringAcceptedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(scenarioAuthoringCallbackService.handleAccepted(
                authoringJobId,
                request.workerId(),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    @PostMapping("/finished")
    public ResponseEntity<ApiResponse<ScenarioAuthoringCallbackAckResponse>> handleFinished(
            @PathVariable UUID authoringJobId,
            @Valid @RequestBody ScenarioAuthoringFinishedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(scenarioAuthoringCallbackService.handleFinished(
                authoringJobId,
                request.toPayloadMap(),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    @PostMapping("/failed")
    public ResponseEntity<ApiResponse<ScenarioAuthoringCallbackAckResponse>> handleFailed(
            @PathVariable UUID authoringJobId,
            @Valid @RequestBody ScenarioAuthoringFailedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(scenarioAuthoringCallbackService.handleFailed(
                authoringJobId,
                request.toPayloadMap(),
                callbackContext(workerId, eventId, signature, request.eventId())
        ));
    }

    private InternalCallbackContext callbackContext(String workerId, String eventId, String signature, String payloadEventId) {
        InternalCallbackContext context = new InternalCallbackContext(workerId, eventId, signature);
        context.validateEventMatches(payloadEventId);
        return context;
    }

    public record ScenarioAuthoringAcceptedRequest(
            @NotBlank String eventId,
            @NotBlank String workerId,
            @NotBlank String acceptedAt
    ) {
    }

    public record ScenarioAuthoringFinishedRequest(
            @NotBlank String eventId,
            @NotBlank String workerId,
            @NotBlank String finishedAt,
            @NotNull List<Map<String, Object>> providerTrace,
            @NotNull List<Map<String, Object>> candidates,
            @NotNull Map<String, Object> validation,
            @NotNull Map<String, Object> provenance
    ) {
        Map<String, Object> toPayloadMap() {
            return Map.of(
                    "eventId", eventId,
                    "workerId", workerId,
                    "finishedAt", finishedAt,
                    "providerTrace", providerTrace,
                    "candidates", candidates,
                    "validation", validation,
                    "provenance", provenance
            );
        }
    }

    public record ScenarioAuthoringFailedRequest(
            @NotBlank String eventId,
            @NotBlank String workerId,
            @NotBlank String failedAt,
            @NotNull Map<String, Object> failure,
            List<Map<String, Object>> providerTrace,
            Map<String, Object> validation,
            Map<String, Object> provenance
    ) {
        Map<String, Object> toPayloadMap() {
            return Map.of(
                    "eventId", eventId,
                    "workerId", workerId,
                    "failedAt", failedAt,
                    "failure", failure,
                    "providerTrace", providerTrace == null ? List.of() : providerTrace,
                    "validation", validation == null ? Map.of() : validation,
                    "provenance", provenance == null ? Map.of() : provenance
            );
        }
    }
}
