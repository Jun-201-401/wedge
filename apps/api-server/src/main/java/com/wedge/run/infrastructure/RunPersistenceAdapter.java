package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunExecutionRequestSource;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RunPersistenceAdapter {
    private static final String RUN_TYPE = "run";

    private final RunMapper runMapper;
    private final CheckpointMapper checkpointMapper;
    private final ArtifactMapper artifactMapper;
    private final ObjectMapper objectMapper;

    public RunPersistenceAdapter(
            RunMapper runMapper,
            CheckpointMapper checkpointMapper,
            ArtifactMapper artifactMapper,
            ObjectMapper objectMapper
    ) {
        this.runMapper = runMapper;
        this.checkpointMapper = checkpointMapper;
        this.artifactMapper = artifactMapper;
        this.objectMapper = objectMapper;
    }

    public record ResolvedStep(UUID id, int stepOrder, String stepKey, StepStatus status) {
    }

    public List<RunResponse> listRuns(UUID projectId, RunStatus status) {
        return runMapper.findAll(projectId, status).stream()
                .map(this::toResponse)
                .toList();
    }

    public Optional<RunResponse> findRun(UUID runId) {
        return runMapper.findById(runId).map(this::toResponse);
    }

    public Optional<RunExecutionRequestSource> findExecutionRequestSource(UUID runId) {
        return runMapper.findById(runId).map(this::toExecutionRequestSource);
    }

    public RunResponse createRun(RunCreateRequest request) {
        RunRecord record = RunRecord.created(request);
        record.setScenarioPlanSchemaVersion(resolveScenarioPlanSchemaVersion(request.scenarioPlan()));
        record.setScenarioPlanJson(writeJsonOrEmpty(request.scenarioPlan()));
        runMapper.insert(record);
        return toResponse(record);
    }

    public RunResponse updateExecutionState(
            RunResponse current,
            RunStatus nextStatus,
            ResultCompleteness nextResultCompleteness
    ) {
        RunResponse next = current.withExecutionState(nextStatus, nextResultCompleteness);
        int updated = runMapper.updateExecutionState(
                current.id(),
                current.status(),
                next.status(),
                next.resultCompleteness(),
                next.startedAt(),
                next.finishedAt()
        );
        if (updated == 0) {
            throw stateConflict(current.status(), nextStatus);
        }
        return next;
    }

    public RunResponse updateFailureState(
            RunResponse current,
            String failureCode,
            String failureMessage,
            ResultCompleteness nextResultCompleteness
    ) {
        RunResponse next = current.withFailure(failureCode, failureMessage, nextResultCompleteness);
        int updated = runMapper.updateFailureState(
                current.id(),
                current.status(),
                next.resultCompleteness(),
                next.finishedAt(),
                next.failureCode(),
                next.failureMessage()
        );
        if (updated == 0) {
            throw stateConflict(current.status(), RunStatus.FAILED);
        }
        return next;
    }

    public boolean softDeleteRun(UUID runId) {
        return runMapper.softDelete(runId) > 0;
    }

    public ResolvedStep resolveStep(UUID runId, String stepKey) {
        return runMapper.findStepByRunIdAndStepKey(runId, stepKey)
                .map(step -> new ResolvedStep(step.getId(), step.getStepOrder(), step.getStepKey(), step.getStatus()))
                .orElseThrow(() -> new BusinessException(
                        ErrorCode.INVALID_REQUEST,
                        "Runner callback step key was not found for the run: " + stepKey
                ));
    }

    public void updateCurrentStepOrder(UUID runId, int stepOrder) {
        runMapper.updateCurrentStepOrder(runId, stepOrder);
    }

    public void updateStepState(UUID stepId, StepStatus nextStatus, OffsetDateTime occurredAt) {
        OffsetDateTime startedAt = nextStatus == StepStatus.RUNNING ? occurredAt : null;
        OffsetDateTime finishedAt = switch (nextStatus) {
            case PASSED, FAILED, SKIPPED, BLOCKED, STOPPED -> occurredAt;
            default -> null;
        };
        runMapper.updateStepState(stepId, nextStatus, startedAt, finishedAt, null, null);
    }

    public void appendRunEvent(UUID runId, UUID stepId, String eventType, Map<String, Object> payload, OffsetDateTime occurredAt) {
        runMapper.insertRunEvent(
                UUID.randomUUID(),
                runId,
                stepId,
                eventType,
                "RUNNER",
                writeJson(payload),
                occurredAt
        );
    }

    public UUID recordCheckpoint(
            UUID runId,
            UUID stepId,
            String checkpointKey,
            String stage,
            Map<String, Object> trigger,
            Map<String, Object> settle,
            Map<String, Object> state,
            List<Map<String, Object>> deltas,
            List<String> artifactRefs,
            OffsetDateTime capturedAt,
            Integer durationMs
    ) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(UUID.randomUUID());
        checkpoint.setRunId(runId);
        checkpoint.setStepId(stepId);
        checkpoint.setCheckpointKey(checkpointKey);
        checkpoint.setStage(stage);
        checkpoint.setTriggerJsonb(writeJson(trigger));
        checkpoint.setSettleJsonb(writeJson(settle));
        checkpoint.setStateJsonb(writeJson(state));
        checkpoint.setDeltaJsonb(writeJson(deltas));
        checkpoint.setArtifactRefsJsonb(writeJson(artifactRefs));
        checkpoint.setCapturedAt(capturedAt);
        checkpoint.setDurationMs(durationMs);
        checkpointMapper.insert(checkpoint);
        runMapper.updateLatestCheckpoint(runId, checkpoint.getId());
        return checkpoint.getId();
    }

    public UUID recordArtifact(
            UUID runId,
            UUID stepId,
            UUID artifactId,
            String artifactType,
            String bucket,
            String key,
            String mimeType,
            Integer width,
            Integer height,
            long sizeBytes,
            String sha256,
            OffsetDateTime createdAt
    ) {
        Artifact artifact = new Artifact();
        artifact.setId(artifactId);
        artifact.setRunId(runId);
        artifact.setStepId(stepId);
        artifact.setArtifactType(ArtifactType.valueOf(artifactType));
        artifact.setS3Bucket(bucket);
        artifact.setS3Key(key);
        artifact.setMimeType(mimeType);
        artifact.setWidth(width);
        artifact.setHeight(height);
        artifact.setSizeBytes(sizeBytes);
        artifact.setSha256(sha256);
        artifact.setCapturedAt(createdAt);
        artifactMapper.insert(artifact);
        runMapper.updateLatestArtifact(runId, artifactId);
        return artifactId;
    }

    private BusinessException stateConflict(RunStatus from, RunStatus to) {
        return new BusinessException(ErrorCode.STATE_CONFLICT, "Run state changed during transition: " + from + " -> " + to);
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to serialize runner callback payload.");
        }
    }

    private RunResponse toResponse(RunRecord record) {
        return new RunResponse(
                record.getId(),
                RUN_TYPE,
                record.getProjectId(),
                record.getName(),
                record.getTriggerSource(),
                URI.create(record.getStartUrl()),
                record.getGoal(),
                record.getDevicePreset(),
                record.getScenarioTemplateVersionId(),
                record.getStatus(),
                record.getResultCompleteness(),
                record.getAnalysisStatus(),
                record.getCurrentStepOrder(),
                record.getStartedAt(),
                record.getFinishedAt(),
                record.getFailureCode(),
                record.getFailureMessage(),
                null
        );
    }

    private RunExecutionRequestSource toExecutionRequestSource(RunRecord record) {
        return new RunExecutionRequestSource(
                record.getId(),
                record.getProjectId(),
                record.getTriggerSource(),
                URI.create(record.getStartUrl()),
                record.getGoal(),
                record.getDevicePreset(),
                record.getScenarioTemplateVersionId(),
                readJsonMap(record.getScenarioPlanJson())
        );
    }

    private String writeJsonOrEmpty(Map<String, Object> payload) {
        if (payload == null || payload.isEmpty()) {
            return "{}";
        }

        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan must be valid JSON", null, exception);
        }
    }

    private Map<String, Object> readJsonMap(String rawJson) {
        try {
            return objectMapper.readValue(rawJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored scenarioPlanJson is invalid", exception);
        }
    }

    private String resolveScenarioPlanSchemaVersion(Map<String, Object> scenarioPlan) {
        if (scenarioPlan == null) {
            return null;
        }

        Object schemaVersion = scenarioPlan.get("schema_version");
        return schemaVersion instanceof String value && !value.isBlank() ? value : null;
    }
}
