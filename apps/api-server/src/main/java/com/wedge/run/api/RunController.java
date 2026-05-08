package com.wedge.run.api;

import com.wedge.common.response.ApiMeta;
import com.wedge.common.response.ApiResponse;
import com.wedge.common.response.RequestMetadata;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.api.dto.ArtifactPresignedUrlRequest;
import com.wedge.evidence.api.dto.ArtifactPresignedUrlsResponse;
import com.wedge.evidence.api.dto.RunEvidenceSummaryResponse;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.run.api.dto.RunActionRequest;
import com.wedge.run.api.dto.RunActionResponse;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.LatestSnapshotResponse;
import com.wedge.run.api.dto.RunEventResponse;
import com.wedge.run.api.dto.RunLiveResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.api.dto.RunStepResponse;
import com.wedge.run.application.RunEventListResult;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.RunStatus;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/runs")
@RequiredArgsConstructor
public class RunController {
    private final RunService runService;
    private final EvidenceService evidenceService;
    private final ProjectAccessService projectAccessService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<RunResponse>>> listRuns(
            @RequestParam(required = false) UUID projectId,
            @RequestParam(required = false) RunStatus status,
            @RequestParam(required = false) AnalysisStatus analysisStatus,
            Authentication authentication
    ) {
        UUID userId = principal(authentication).userId();
        if (projectId != null) {
            projectAccessService.ensureProjectAccessible(projectId, userId);
        }
        return ApiResponse.ok(runService.listRuns(projectId, status).stream()
                .filter(run -> projectId != null || projectAccessService.isProjectMember(run.projectId(), userId))
                .filter(run -> analysisStatus == null || run.analysisStatus() == analysisStatus)
                .toList());
    }

    @PostMapping
    public ResponseEntity<ApiResponse<RunResponse>> createRun(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody RunCreateRequest request,
            Authentication authentication
    ) {
        projectAccessService.ensureProjectAccessible(request.projectId(), principal(authentication).userId());
        return ApiResponse.created(runService.createRun(request));
    }

    @GetMapping("/{runId}")
    public ResponseEntity<ApiResponse<RunResponse>> getRun(@PathVariable UUID runId, Authentication authentication) {
        return ApiResponse.ok(getAccessibleRun(runId, authentication));
    }

    @DeleteMapping("/{runId}")
    public ResponseEntity<Void> deleteRun(@PathVariable UUID runId, Authentication authentication) {
        ensureRunAccessible(runId, authentication);
        runService.deleteRun(runId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{runId}/start")
    public ResponseEntity<ApiResponse<RunActionResponse>> startRun(
            @PathVariable UUID runId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            Authentication authentication
    ) {
        ensureRunAccessible(runId, authentication);
        RunResponse run = runService.startRun(runId);
        return ApiResponse.accepted(RunActionResponse.from(run));
    }

    @PostMapping("/{runId}/stop")
    public ResponseEntity<ApiResponse<RunActionResponse>> stopRun(
            @PathVariable UUID runId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) RunActionRequest request,
            Authentication authentication
    ) {
        ensureRunAccessible(runId, authentication);
        RunResponse run = runService.stopRun(runId);
        return ApiResponse.accepted(RunActionResponse.from(run));
    }

    @GetMapping("/{runId}/live")
    public ResponseEntity<ApiResponse<RunLiveResponse>> getRunLive(@PathVariable UUID runId, Authentication authentication) {
        RunResponse run = getAccessibleRun(runId, authentication);
        RunEvidenceSummaryResponse evidenceSummary = evidenceService.getRunEvidenceSummary(run);
        return ApiResponse.ok(new RunLiveResponse(
                run.id(),
                run.status(),
                run.currentStepOrder(),
                null,
                toLatestFrame(evidenceSummary.latestFrameArtifact(), run.latestSnapshot()),
                evidenceSummary.latestCheckpoint(),
                evidenceSummary.latestArtifact(),
                evidenceSummary.evidenceCounts()
        ));
    }

    private LatestSnapshotResponse toLatestFrame(ArtifactResponse frameArtifact, LatestSnapshotResponse fallback) {
        if (frameArtifact == null) {
            return fallback;
        }
        String url = frameArtifact.url() == null || frameArtifact.url().isBlank()
                ? frameArtifact.contentUrl()
                : frameArtifact.url();
        return url == null || url.isBlank()
                ? fallback
                : new LatestSnapshotResponse(frameArtifact.id(), URI.create(url), frameArtifact.createdAt());
    }

    @GetMapping("/{runId}/steps")
    public ResponseEntity<ApiResponse<List<RunStepResponse>>> listRunSteps(@PathVariable UUID runId, Authentication authentication) {
        ensureRunAccessible(runId, authentication);
        return ApiResponse.ok(runService.listRunSteps(runId));
    }

    @GetMapping("/{runId}/steps/{stepId}")
    public ResponseEntity<ApiResponse<RunStepResponse>> getRunStep(
            @PathVariable UUID runId,
            @PathVariable UUID stepId,
            Authentication authentication
    ) {
        ensureRunAccessible(runId, authentication);
        return ApiResponse.ok(runService.getRunStep(runId, stepId));
    }

    @GetMapping("/{runId}/events")
    public ResponseEntity<ApiResponse<List<RunEventResponse>>> listRunEvents(
            @PathVariable UUID runId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) UUID stepId,
            @RequestParam(required = false) String eventType,
            Authentication authentication
    ) {
        ensureRunAccessible(runId, authentication);
        RunEventListResult result = runService.listRunEvents(runId, stepId, eventType, cursor, limit);
        ApiMeta currentMeta = RequestMetadata.current();
        return ResponseEntity.ok(new ApiResponse<>(
                result.events(),
                ApiMeta.page(currentMeta.requestId(), currentMeta.correlationId(), result.nextCursor(), result.hasMore())
        ));
    }

    @GetMapping("/{runId}/artifacts")
    public ResponseEntity<ApiResponse<List<ArtifactResponse>>> listRunArtifacts(@PathVariable UUID runId, Authentication authentication) {
        ensureRunAccessible(runId, authentication);
        return ApiResponse.ok(evidenceService.listRunArtifacts(runId));
    }

    @PostMapping("/{runId}/artifacts/presigned-urls")
    public ResponseEntity<ApiResponse<ArtifactPresignedUrlsResponse>> createRunArtifactPresignedUrls(
            @PathVariable UUID runId,
            @Valid @RequestBody ArtifactPresignedUrlRequest request
    ) {
        return ApiResponse.ok(evidenceService.createRunArtifactPresignedUrls(runId, request.artifactIds()));
    }

    @GetMapping("/{runId}/artifacts/{artifactId}/content")
    public ResponseEntity<Resource> getRunArtifactContent(
            @PathVariable UUID runId,
            @PathVariable UUID artifactId,
            Authentication authentication
    ) {
        ensureRunAccessible(runId, authentication);
        EvidenceService.ArtifactContent artifactContent = evidenceService.getRunArtifactContent(runId, artifactId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(artifactContent.mimeType()))
                .body(artifactContent.resource());
    }

    @GetMapping("/{runId}/signals")
    public ResponseEntity<ApiResponse<List<Object>>> listRunSignals(@PathVariable UUID runId, Authentication authentication) {
        ensureRunAccessible(runId, authentication);
        return ApiResponse.ok(List.of());
    }

    @GetMapping("/{runId}/evidence-packet")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getEvidencePacket(@PathVariable UUID runId, Authentication authentication) {
        ensureRunAccessible(runId, authentication);
        return ApiResponse.ok(evidenceService.getRunEvidencePacket(runId));
    }

    private RunResponse getAccessibleRun(UUID runId, Authentication authentication) {
        RunResponse run = runService.getRun(runId);
        projectAccessService.ensureProjectAccessible(run.projectId(), principal(authentication).userId());
        return run;
    }

    private void ensureRunAccessible(UUID runId, Authentication authentication) {
        getAccessibleRun(runId, authentication);
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
