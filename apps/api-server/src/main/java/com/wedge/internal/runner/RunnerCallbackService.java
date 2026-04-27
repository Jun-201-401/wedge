package com.wedge.internal.runner;

import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerStepEventsRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.infrastructure.RunMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunnerCallbackService {
    private static final String ACCEPTED_CONSUMER = "runner.accepted";
    private static final String STEP_EVENTS_CONSUMER = "runner.step-events";
    private static final String CHECKPOINTS_CONSUMER = "runner.checkpoints";
    private static final String ARTIFACTS_CONSUMER = "runner.artifacts";
    private static final String FINISHED_CONSUMER = "runner.finished";
    private static final String FAILED_CONSUMER = "runner.failed";

    private final RunService runService;
    private final ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;
    private final ArtifactPersistenceService artifactPersistenceService;
    private final ArtifactMapper artifactMapper;
    private final CheckpointPersistenceService checkpointPersistenceService;
    private final RunMapper runMapper;

    public RunnerCallbackService(
            RunService runService,
            ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter,
            ArtifactPersistenceService artifactPersistenceService,
            CheckpointPersistenceService checkpointPersistenceService
            ArtifactMapper artifactMapper,
            CheckpointPersistenceService checkpointPersistenceService,
            RunMapper runMapper
    ) {
        this.runService = runService;
        this.processedMessagePersistenceAdapter = processedMessagePersistenceAdapter;
        this.artifactMapper = artifactMapper;
        this.artifactPersistenceService = artifactPersistenceService;
        this.checkpointPersistenceService = checkpointPersistenceService;
        this.runMapper = runMapper;
    }

    @Transactional
    public Map<String, Object> handleAccepted(UUID runId, RunnerAcceptedRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        headers.validateWorkerMatches(request.workerId());

        Map<String, Object> duplicateResponse = duplicateStatusResponse(ACCEPTED_CONSUMER, headers.eventId(), runId);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        RunResponse run = runService.markAccepted(runId);
        return Map.of("runId", run.id(), "status", run.status());
    }

    @Transactional
    public Map<String, Object> handleStepEvents(UUID runId, RunnerStepEventsRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();

        Map<String, Object> duplicateResponse = duplicateStatusResponse(STEP_EVENTS_CONSUMER, headers.eventId(), runId);
        if (duplicateResponse != null) {
            return extendDuplicateResponse(duplicateResponse, "eventCount", request.events().size());
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        return Map.of("runId", run.id(), "status", run.status(), "eventCount", request.events().size());
    }

    @Transactional
    public Map<String, Object> handleCheckpoints(UUID runId, RunnerCheckpointsRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();

        if (isDuplicate(CHECKPOINTS_CONSUMER, headers.eventId())) {
            runService.getRun(runId);
            return Map.of("runId", runId, "checkpointCount", request.checkpoints().size(), "duplicate", true);
        }

        runService.getRun(runId);
        int checkpointCount = checkpointPersistenceService.saveRunCheckpoints(runId, request);
        return Map.of("runId", runId, "checkpointCount", checkpointCount);
    }

    @Transactional
    public Map<String, Object> handleArtifacts(UUID runId, RunnerArtifactsRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();

        if (isDuplicate(ARTIFACTS_CONSUMER, headers.eventId())) {
            runService.getRun(runId);
            return Map.of("runId", runId, "artifactCount", request.artifacts().size(), "duplicate", true);
        }

        runService.getRun(runId);
        UUID latestArtifactId = persistArtifacts(runId, request.artifacts());
        if (latestArtifactId != null) {
            runMapper.updateLatestArtifact(runId, latestArtifactId);
        }
        return Map.of("runId", runId, "artifactCount", request.artifacts().size());
        int artifactCount = artifactPersistenceService.saveRunArtifacts(runId, request);
        return Map.of("runId", runId, "artifactCount", artifactCount);
    }

    @Transactional
    public Map<String, Object> handleFinished(UUID runId, RunnerFinishedRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        headers.validateWorkerMatches(request.workerId());

        Map<String, Object> duplicateResponse = duplicateStatusResponse(FINISHED_CONSUMER, headers.eventId(), runId);
        if (duplicateResponse != null) {
            return extendDuplicateResponse(duplicateResponse, "resultCompleteness", duplicateResponse.get("resultCompleteness"));
        }

        RunResponse run = runService.finishRun(runId, request.summary().stopped());
        return Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness());
    }

    @Transactional
    public Map<String, Object> handleFailed(UUID runId, RunnerFailedRequest request, RunnerCallbackHeaders headers) {
        headers.validateRequired();
        headers.validateWorkerMatches(request.workerId());

        Map<String, Object> duplicateResponse = duplicateStatusResponse(FAILED_CONSUMER, headers.eventId(), runId);
        if (duplicateResponse != null) {
            return extendDuplicateResponse(duplicateResponse, "resultCompleteness", duplicateResponse.get("resultCompleteness"));
        }

        RunResponse run = runService.failRun(runId, request.failureCode(), request.failureMessage(), request.resultCompleteness());
        return Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness());
    }

    private boolean isDuplicate(String consumerName, String eventId) {
        return !processedMessagePersistenceAdapter.tryMarkProcessed(consumerName, eventId);
    }

    private Map<String, Object> duplicateStatusResponse(String consumerName, String eventId, UUID runId) {
        if (!isDuplicate(consumerName, eventId)) {
            return null;
        }

        RunResponse run = runService.getRun(runId);
        return Map.of(
                "runId", run.id(),
                "status", run.status(),
                "resultCompleteness", run.resultCompleteness(),
                "duplicate", true
        );
    }

    private Map<String, Object> extendDuplicateResponse(Map<String, Object> base, String key, Object value) {
        return Map.of(
                "runId", base.get("runId"),
                "status", base.get("status"),
                key, value,
                "duplicate", true
        );
    }

    private UUID persistArtifacts(UUID runId, List<RunnerArtifactRequest> artifactRequests) {
        UUID latestArtifactId = null;
        for (RunnerArtifactRequest artifactRequest : artifactRequests) {
            Artifact artifact = toArtifact(runId, artifactRequest);
            artifactMapper.insert(artifact);
            latestArtifactId = artifact.getId();
        }
        return latestArtifactId;
    }

    private Artifact toArtifact(UUID runId, RunnerArtifactRequest request) {
        Artifact artifact = new Artifact();
        artifact.setId(request.artifactId());
        artifact.setRunId(runId);
        artifact.setArtifactType(ArtifactType.valueOf(request.artifactType().name()));
        artifact.setS3Bucket(request.bucket());
        artifact.setS3Key(request.key());
        artifact.setMimeType(request.mimeType());
        artifact.setWidth(request.width());
        artifact.setHeight(request.height());
        artifact.setSizeBytes(request.sizeBytes());
        artifact.setSha256(request.sha256());
        artifact.setCapturedAt(request.createdAt());
        return artifact;
    }
}
