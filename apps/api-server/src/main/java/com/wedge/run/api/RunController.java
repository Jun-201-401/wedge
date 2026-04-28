package com.wedge.run.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.run.api.dto.RunActionRequest;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunLiveResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.RunStatus;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

    @GetMapping
    public ResponseEntity<ApiResponse<List<RunResponse>>> listRuns(
            @RequestParam(required = false) UUID projectId,
            @RequestParam(required = false) RunStatus status,
            @RequestParam(required = false) AnalysisStatus analysisStatus
    ) {
        return ApiResponse.ok(runService.listRuns(projectId, status).stream()
                .filter(run -> analysisStatus == null || run.analysisStatus() == analysisStatus)
                .toList());
    }

    @PostMapping
    public ResponseEntity<ApiResponse<RunResponse>> createRun(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody RunCreateRequest request
    ) {
        return ApiResponse.created(runService.createRun(request));
    }

    @GetMapping("/{runId}")
    public ResponseEntity<ApiResponse<RunResponse>> getRun(@PathVariable UUID runId) {
        return ApiResponse.ok(runService.getRun(runId));
    }

    @DeleteMapping("/{runId}")
    public ResponseEntity<Void> deleteRun(@PathVariable UUID runId) {
        runService.deleteRun(runId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{runId}/start")
    public ResponseEntity<ApiResponse<Map<String, Object>>> startRun(
            @PathVariable UUID runId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey
    ) {
        RunResponse run = runService.startRun(runId);
        return ApiResponse.accepted(Map.of("runId", run.id(), "status", run.status()));
    }

    @PostMapping("/{runId}/stop")
    public ResponseEntity<ApiResponse<Map<String, Object>>> stopRun(
            @PathVariable UUID runId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) RunActionRequest request
    ) {
        RunResponse run = runService.stopRun(runId);
        return ApiResponse.accepted(Map.of("runId", run.id(), "status", run.status()));
    }

    @GetMapping("/{runId}/live")
    public ResponseEntity<ApiResponse<RunLiveResponse>> getRunLive(@PathVariable UUID runId) {
        RunResponse run = runService.getRun(runId);
        return ApiResponse.ok(new RunLiveResponse(run.id(), run.status(), run.currentStepOrder(), null, run.latestSnapshot()));
    }

    @GetMapping("/{runId}/steps")
    public ResponseEntity<ApiResponse<List<Object>>> listRunSteps(@PathVariable UUID runId) {
        runService.getRun(runId);
        return ApiResponse.ok(List.of());
    }

    @GetMapping("/{runId}/steps/{stepId}")
    public ResponseEntity<ApiResponse<Object>> getRunStep(@PathVariable UUID runId, @PathVariable UUID stepId) {
        runService.getRun(runId);
        return ApiResponse.ok(Map.of("runId", runId, "stepId", stepId));
    }

    @GetMapping("/{runId}/events")
    public ResponseEntity<ApiResponse<List<Object>>> listRunEvents(@PathVariable UUID runId) {
        runService.getRun(runId);
        return ApiResponse.ok(List.of());
    }

    @GetMapping("/{runId}/artifacts")
    public ResponseEntity<ApiResponse<List<ArtifactResponse>>> listRunArtifacts(@PathVariable UUID runId) {
        return ApiResponse.ok(evidenceService.listRunArtifacts(runId));
    }

    @GetMapping("/{runId}/artifacts/{artifactId}/content")
    public ResponseEntity<Resource> getRunArtifactContent(@PathVariable UUID runId, @PathVariable UUID artifactId) {
        EvidenceService.ArtifactContent artifactContent = evidenceService.getRunArtifactContent(runId, artifactId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(artifactContent.mimeType()))
                .body(artifactContent.resource());
    }

    @GetMapping("/{runId}/signals")
    public ResponseEntity<ApiResponse<List<Object>>> listRunSignals(@PathVariable UUID runId) {
        runService.getRun(runId);
        return ApiResponse.ok(List.of());
    }

    @GetMapping("/{runId}/evidence-packet")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getEvidencePacket(@PathVariable UUID runId) {
        return ApiResponse.ok(evidenceService.getRunEvidencePacket(runId));
    }
}
