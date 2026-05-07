package com.wedge.scenarioauthoring.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringConfirmRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringConfirmResponse;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobCreateRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobResponse;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringJobService;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/scenario-authoring-jobs")
@RequiredArgsConstructor
public class ScenarioAuthoringJobController {
    private final ScenarioAuthoringJobService scenarioAuthoringJobService;

    @PostMapping
    public ResponseEntity<ApiResponse<ScenarioAuthoringJobResponse>> createJob(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody ScenarioAuthoringJobCreateRequest request,
            Authentication authentication
    ) {
        return ApiResponse.accepted(scenarioAuthoringJobService.createJob(request, principal(authentication).userId(), idempotencyKey));
    }

    @GetMapping("/{authoringJobId}")
    public ResponseEntity<ApiResponse<ScenarioAuthoringJobResponse>> getJob(
            @PathVariable UUID authoringJobId,
            Authentication authentication
    ) {
        return ApiResponse.ok(scenarioAuthoringJobService.getJob(authoringJobId, principal(authentication).userId()));
    }

    @PostMapping("/{authoringJobId}/confirm")
    public ResponseEntity<ApiResponse<ScenarioAuthoringConfirmResponse>> confirmCandidate(
            @PathVariable UUID authoringJobId,
            @Valid @RequestBody ScenarioAuthoringConfirmRequest request,
            Authentication authentication
    ) {
        return ApiResponse.ok(scenarioAuthoringJobService.confirmCandidate(authoringJobId, request, principal(authentication).userId()));
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
