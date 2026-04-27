package com.wedge.internal.runner;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerCheckpointRequest;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerStepEventsRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.infrastructure.RunMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
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
    private final ArtifactMapper artifactMapper;
    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final RunMapper runMapper;
    private final ObjectMapper objectMapper;

    public RunnerCallbackService(
            RunService runService,
            ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter,
            ArtifactMapper artifactMapper,
            CheckpointMapper checkpointMapper,
            ObservationMapper observationMapper,
            RunMapper runMapper,
            ObjectMapper objectMapper
    ) {
        this.runService = runService;
        this.processedMessagePersistenceAdapter = processedMessagePersistenceAdapter;
        this.artifactMapper = artifactMapper;
        this.checkpointMapper = checkpointMapper;
        this.observationMapper = observationMapper;
        this.runMapper = runMapper;
        this.objectMapper = objectMapper;
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
        UUID latestCheckpointId = persistCheckpoints(runId, request.checkpoints());
        if (latestCheckpointId != null) {
            runMapper.updateLatestCheckpoint(runId, latestCheckpointId);
        }
        return Map.of("runId", runId, "checkpointCount", request.checkpoints().size());
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

    private UUID persistCheckpoints(UUID runId, List<RunnerCheckpointRequest> checkpointRequests) {
        UUID latestCheckpointId = null;
        for (RunnerCheckpointRequest checkpointRequest : checkpointRequests) {
            Checkpoint checkpoint = toCheckpoint(runId, checkpointRequest);
            checkpointMapper.insert(checkpoint);
            latestCheckpointId = checkpoint.getId();
            persistObservations(runId, checkpoint, checkpointRequest.observations());
        }
        return latestCheckpointId;
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

    private Checkpoint toCheckpoint(UUID runId, RunnerCheckpointRequest request) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(UUID.randomUUID());
        checkpoint.setRunId(runId);
        checkpoint.setCheckpointKey(request.checkpointId());
        checkpoint.setStage(request.stage().name());
        checkpoint.setTriggerJsonb(writeJson(request.trigger()));
        checkpoint.setSettleJsonb(writeJson(toSettlePayload(request)));
        checkpoint.setStateJsonb(writeJson(request.state()));
        checkpoint.setDeltaJsonb(writeJson(request.deltas()));
        checkpoint.setArtifactRefsJsonb(writeJson(request.artifactRefs()));
        checkpoint.setDurationMs(request.settle().durationMs());
        checkpoint.setCapturedAt(OffsetDateTime.now());
        return checkpoint;
    }

    private Map<String, Object> toSettlePayload(RunnerCheckpointRequest request) {
        return Map.of(
                "strategy", request.settle().strategy(),
                "durationMs", request.settle().durationMs(),
                "status", request.settle().status().name()
        );
    }

    private void persistObservations(UUID runId, Checkpoint checkpoint, List<Map<String, Object>> observations) {
        int observationIndex = 1;
        for (Map<String, Object> observationPayload : observations) {
            Observation observation = toObservation(runId, checkpoint, observationPayload, observationIndex);
            observationMapper.insert(observation);
            observationIndex += 1;
        }
    }

    private Observation toObservation(
            UUID runId,
            Checkpoint checkpoint,
            Map<String, Object> payload,
            int observationIndex
    ) {
        Observation observation = new Observation();
        observation.setId(UUID.randomUUID());
        observation.setCheckpointId(checkpoint.getId());
        observation.setRunId(runId);
        observation.setObservationKey(readString(payload, "observation_id",
                checkpoint.getCheckpointKey() + ".obs_" + String.format("%03d", observationIndex)));
        observation.setObservationType(readString(payload, "type", "other"));
        observation.setStage(readString(payload, "stage", inferObservationStage(observation.getObservationType(), checkpoint.getStage())));
        observation.setSourcesJsonb(writeJson(readSources(payload, observation.getObservationType())));
        observation.setDataJsonb(writeJson(extractObservationData(payload)));
        observation.setConfidence(readConfidence(payload));
        return observation;
    }

    private String inferObservationStage(String observationType, String fallbackStage) {
        return switch (observationType) {
            case "cta_candidate", "cta_cluster", "cta_text_specificity" -> "CTA";
            case "form_field", "form_error", "required_field", "missing_label", "error_recovery", "submit_disabled" -> "INPUT";
            case "trust_signal", "final_submit_candidate", "terms_privacy_signal", "payment_or_sensitive_action" -> "COMMIT";
            case "value_proposition", "feature_summary", "audience_signal" -> "VALUE";
            default -> fallbackStage;
        };
    }

    private List<String> readSources(Map<String, Object> payload, String observationType) {
        Object source = payload.get("source");
        if (source == null) {
            source = payload.get("sources");
        }

        if (source instanceof List<?> sourceList) {
            return sourceList.stream()
                    .map(String::valueOf)
                    .toList();
        }

        return switch (observationType) {
            case "console_error" -> List.of("console");
            case "network_failure", "settle_response" -> List.of("network");
            case "cta_candidate", "form_field" -> List.of("dom");
            case "settle_item_count_change" -> List.of("scenario_log");
            default -> List.of("scenario_log");
        };
    }

    private Map<String, Object> extractObservationData(Map<String, Object> payload) {
        Map<String, Object> data = new LinkedHashMap<>(payload);
        data.remove("observation_id");
        data.remove("type");
        data.remove("stage");
        data.remove("source");
        data.remove("sources");
        data.remove("confidence");
        return data;
    }

    private String readString(Map<String, Object> payload, String key, String defaultValue) {
        Object value = payload.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        return defaultValue;
    }

    private BigDecimal readConfidence(Map<String, Object> payload) {
        Object value = payload.get("confidence");
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue());
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return new BigDecimal(text);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private String writeJson(Object payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize runner evidence callback payload", exception);
        }
    }
}
