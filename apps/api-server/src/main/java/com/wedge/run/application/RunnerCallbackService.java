package com.wedge.run.application;

import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.evidence.application.command.SaveRunArtifactCommand;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.command.RunnerAcceptedCommand;
import com.wedge.run.application.command.RunnerArtifactCommand;
import com.wedge.run.application.command.RunnerArtifactsCommand;
import com.wedge.run.application.command.RunnerCallbackContext;
import com.wedge.run.application.command.RunnerCheckpointCommand;
import com.wedge.run.application.command.RunnerCheckpointsCommand;
import com.wedge.run.application.command.RunnerFailedCommand;
import com.wedge.run.application.command.RunnerFinishedCommand;
import com.wedge.run.application.command.RunnerStepEventCommand;
import com.wedge.run.application.command.RunnerStepEventsCommand;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunnerCallbackService {
    private static final String ACCEPTED_CONSUMER = "runner.accepted";
    private static final String STEP_EVENTS_CONSUMER = "runner.step-events";
    private static final String CHECKPOINTS_CONSUMER = "runner.checkpoints";
    private static final String ARTIFACTS_CONSUMER = "runner.artifacts";
    private static final String FINISHED_CONSUMER = "runner.finished";
    private static final String FAILED_CONSUMER = "runner.failed";

    private final RunService runService;
    private final RunPersistenceAdapter runPersistenceAdapter;
    private final ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;
    private final ArtifactPersistenceService artifactPersistenceService;
    private final CheckpointPersistenceService checkpointPersistenceService;

    @Transactional
    public Map<String, Object> handleAccepted(UUID runId, RunnerAcceptedCommand command, RunnerCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());

        Map<String, Object> duplicateResponse = duplicateStatusResponse(ACCEPTED_CONSUMER, context.eventId(), runId);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        RunResponse run = runService.markAccepted(runId);
        return Map.of("runId", run.id(), "status", run.status());
    }

    @Transactional
    public Map<String, Object> handleStepEvents(UUID runId, RunnerStepEventsCommand command, RunnerCallbackContext context) {
        context.validateRequired();

        Map<String, Object> duplicateResponse = duplicateStatusResponse(STEP_EVENTS_CONSUMER, context.eventId(), runId);
        if (duplicateResponse != null) {
            return extendDuplicateResponse(duplicateResponse, "eventCount", command.events().size());
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        if (!isTerminalStatus(run.status())) {
            command.events().forEach(event -> applyStepEvent(runId, event));
        }
        return Map.of("runId", run.id(), "status", run.status(), "eventCount", command.events().size());
    }

    @Transactional
    public Map<String, Object> handleCheckpoints(UUID runId, RunnerCheckpointsCommand command, RunnerCallbackContext context) {
        context.validateRequired();

        if (isDuplicate(CHECKPOINTS_CONSUMER, context.eventId())) {
            runService.getRun(runId);
            return Map.of("runId", runId, "checkpointCount", command.checkpoints().size(), "duplicate", true);
        }

        runService.getRun(runId);
        SaveRunCheckpointsCommand saveCommand = toSaveRunCheckpointsCommand(command);
        Map<String, UUID> stepIdsByKey = resolveCheckpointSteps(runId, saveCommand);
        int checkpointCount = checkpointPersistenceService.saveRunCheckpoints(runId, saveCommand, stepIdsByKey);
        return Map.of("runId", runId, "checkpointCount", checkpointCount);
    }

    @Transactional
    public Map<String, Object> handleArtifacts(UUID runId, RunnerArtifactsCommand command, RunnerCallbackContext context) {
        context.validateRequired();

        if (isDuplicate(ARTIFACTS_CONSUMER, context.eventId())) {
            runService.getRun(runId);
            return Map.of("runId", runId, "artifactCount", command.artifacts().size(), "duplicate", true);
        }

        runService.getRun(runId);
        SaveRunArtifactsCommand saveCommand = toSaveRunArtifactsCommand(command);
        Map<String, UUID> stepIdsByKey = resolveArtifactSteps(runId, saveCommand);
        int artifactCount = artifactPersistenceService.saveRunArtifacts(runId, saveCommand, stepIdsByKey);
        UUID latestArtifactId = command.artifacts().get(command.artifacts().size() - 1).artifactId();
        if (latestArtifactId != null) {
            runPersistenceAdapter.updateLatestArtifact(runId, latestArtifactId);
        }
        return Map.of("runId", runId, "artifactCount", artifactCount);
    }

    @Transactional
    public Map<String, Object> handleFinished(UUID runId, RunnerFinishedCommand command, RunnerCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());

        Map<String, Object> duplicateResponse = duplicateStatusResponse(FINISHED_CONSUMER, context.eventId(), runId);
        if (duplicateResponse != null) {
            return extendDuplicateResponse(duplicateResponse, "resultCompleteness", duplicateResponse.get("resultCompleteness"));
        }

        RunResponse run = runService.finishRun(runId, command.stopped());
        return Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness());
    }

    @Transactional
    public Map<String, Object> handleFailed(UUID runId, RunnerFailedCommand command, RunnerCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());

        Map<String, Object> duplicateResponse = duplicateStatusResponse(FAILED_CONSUMER, context.eventId(), runId);
        if (duplicateResponse != null) {
            return extendDuplicateResponse(duplicateResponse, "resultCompleteness", duplicateResponse.get("resultCompleteness"));
        }

        RunResponse run = runService.failRun(runId, command.failureCode(), command.failureMessage(), command.resultCompleteness());
        return Map.of("runId", run.id(), "status", run.status(), "resultCompleteness", run.resultCompleteness());
    }

    private void applyStepEvent(UUID runId, RunnerStepEventCommand event) {
        RunPersistenceAdapter.ResolvedStep step = runPersistenceAdapter.resolveStep(runId, event.stepKey());
        runPersistenceAdapter.updateCurrentStepOrder(runId, step.stepOrder());
        runPersistenceAdapter.appendRunEvent(runId, step.id(), event.eventType(), event.payload(), event.occurredAt());

        StepStatus nextStatus = mapStepStatus(event.eventType());
        if (nextStatus != null) {
            runPersistenceAdapter.updateStepState(step.id(), nextStatus, event.occurredAt());
        }
    }

    private SaveRunCheckpointsCommand toSaveRunCheckpointsCommand(RunnerCheckpointsCommand command) {
        return new SaveRunCheckpointsCommand(command.checkpoints().stream()
                .map(this::toSaveRunCheckpointCommand)
                .toList());
    }

    private SaveRunCheckpointCommand toSaveRunCheckpointCommand(RunnerCheckpointCommand checkpoint) {
        return new SaveRunCheckpointCommand(
                checkpoint.checkpointId(),
                checkpoint.stepKey(),
                checkpoint.stage(),
                checkpoint.trigger(),
                checkpoint.settle(),
                checkpoint.durationMs(),
                checkpoint.state(),
                checkpoint.observations(),
                checkpoint.deltas(),
                checkpoint.artifactRefs()
        );
    }

    private SaveRunArtifactsCommand toSaveRunArtifactsCommand(RunnerArtifactsCommand command) {
        return new SaveRunArtifactsCommand(command.artifacts().stream()
                .map(this::toSaveRunArtifactCommand)
                .toList());
    }

    private SaveRunArtifactCommand toSaveRunArtifactCommand(RunnerArtifactCommand artifact) {
        return new SaveRunArtifactCommand(
                artifact.artifactId(),
                artifact.stepKey(),
                ArtifactType.valueOf(artifact.artifactType()),
                artifact.bucket(),
                artifact.key(),
                artifact.mimeType(),
                artifact.width(),
                artifact.height(),
                artifact.sizeBytes(),
                artifact.sha256(),
                artifact.createdAt()
        );
    }

    private Map<String, UUID> resolveCheckpointSteps(UUID runId, SaveRunCheckpointsCommand command) {
        Map<String, UUID> stepIdsByKey = new LinkedHashMap<>();
        for (SaveRunCheckpointCommand checkpoint : command.checkpoints()) {
            RunPersistenceAdapter.ResolvedStep step = runPersistenceAdapter.resolveStep(runId, checkpoint.stepKey());
            runPersistenceAdapter.updateCurrentStepOrder(runId, step.stepOrder());
            stepIdsByKey.put(checkpoint.stepKey(), step.id());
        }
        return stepIdsByKey;
    }

    private Map<String, UUID> resolveArtifactSteps(UUID runId, SaveRunArtifactsCommand command) {
        Map<String, UUID> stepIdsByKey = new LinkedHashMap<>();
        for (SaveRunArtifactCommand artifact : command.artifacts()) {
            RunPersistenceAdapter.ResolvedStep step = runPersistenceAdapter.resolveStep(runId, artifact.stepKey());
            runPersistenceAdapter.updateCurrentStepOrder(runId, step.stepOrder());
            stepIdsByKey.put(artifact.stepKey(), step.id());
        }
        return stepIdsByKey;
    }

    private StepStatus mapStepStatus(String eventType) {
        return switch (eventType) {
            case "STEP_STARTED" -> StepStatus.RUNNING;
            case "STEP_COMPLETED" -> StepStatus.PASSED;
            default -> null;
        };
    }

    private boolean isTerminalStatus(RunStatus status) {
        return status == RunStatus.COMPLETED || status == RunStatus.FAILED || status == RunStatus.STOPPED;
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
}
