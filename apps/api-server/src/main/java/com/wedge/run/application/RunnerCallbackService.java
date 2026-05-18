package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.evidence.application.SaveRunCheckpointsResult;
import com.wedge.evidence.application.command.SaveRunArtifactCommand;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.api.internal.runner.dto.RunnerControlStateResponse;
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
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
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
    private static final String AGENT_EVENTS_CONSUMER = "runner.agent-events";
    private static final String AGENT_TRACES_CONSUMER = "runner.agent-traces";
    private static final Set<String> RUN_SCOPED_AGENT_ARTIFACT_KEYS = Set.of(
            "agent_trace",
            "agent_scenario_plan_export",
            "agent_replay_plan"
    );

    private final RunService runService;
    private final RunPersistenceAdapter runPersistenceAdapter;
    private final ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;
    private final ArtifactPersistenceService artifactPersistenceService;
    private final CheckpointPersistenceService checkpointPersistenceService;

    @Transactional
    public RunnerCallbackAckResponse handleAccepted(UUID runId, RunnerAcceptedCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());

        RunnerCallbackAckResponse duplicateResponse = duplicateStatusResponse(ACCEPTED_CONSUMER, context.eventId(), runId, command);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        RunResponse run = runService.markAccepted(runId);
        return RunnerCallbackAckResponse.accepted(run);
    }

    @Transactional
    public RunnerCallbackAckResponse handleStepEvents(UUID runId, RunnerStepEventsCommand command, InternalCallbackContext context) {
        context.validateRequired();

        RunnerCallbackAckResponse duplicateResponse = duplicateStatusResponse(STEP_EVENTS_CONSUMER, context.eventId(), runId, command);
        if (duplicateResponse != null) {
            return duplicateResponse.withEventCount(command.events().size());
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        if (!isTerminalStatus(run.status())) {
            command.events().forEach(event -> applyStepEvent(runId, event));
        }
        return RunnerCallbackAckResponse.stepEvents(run, command.events().size());
    }

    @Transactional
    public RunnerCallbackAckResponse handleCheckpoints(UUID runId, RunnerCheckpointsCommand command, InternalCallbackContext context) {
        context.validateRequired();

        if (isDuplicate(CHECKPOINTS_CONSUMER, context.eventId(), runId, command)) {
            runService.getRun(runId);
            return RunnerCallbackAckResponse.duplicateCheckpoints(runId, command.checkpoints().size());
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        rejectTerminalEvidence(run);
        SaveRunCheckpointsCommand saveCommand = toSaveRunCheckpointsCommand(command);
        Map<String, UUID> stepIdsByKey = resolveCheckpointSteps(runId, saveCommand);
        SaveRunCheckpointsResult result = checkpointPersistenceService.saveRunCheckpoints(runId, saveCommand, stepIdsByKey);
        result.latestInsertedCheckpointId()
                .ifPresent(checkpointId -> runPersistenceAdapter.updateLatestCheckpoint(runId, checkpointId));
        return RunnerCallbackAckResponse.checkpoints(runId, result.checkpointCount());
    }

    @Transactional
    public RunnerCallbackAckResponse handleArtifacts(UUID runId, RunnerArtifactsCommand command, InternalCallbackContext context) {
        context.validateRequired();

        if (isDuplicate(ARTIFACTS_CONSUMER, context.eventId(), runId, command)) {
            runService.getRun(runId);
            return RunnerCallbackAckResponse.duplicateArtifacts(runId, command.artifacts().size());
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        rejectTerminalEvidence(run);
        SaveRunArtifactsCommand saveCommand = toSaveRunArtifactsCommand(command);
        Map<String, UUID> stepIdsByKey = resolveArtifactSteps(runId, saveCommand);
        int artifactCount = artifactPersistenceService.saveRunArtifacts(runId, saveCommand, stepIdsByKey);
        UUID latestArtifactId = command.artifacts().get(command.artifacts().size() - 1).artifactId();
        if (latestArtifactId != null) {
            runPersistenceAdapter.updateLatestArtifact(runId, latestArtifactId);
        }
        return RunnerCallbackAckResponse.artifacts(runId, artifactCount);
    }

    @Transactional
    public RunnerCallbackAckResponse handleFinished(UUID runId, RunnerFinishedCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());

        RunnerCallbackAckResponse duplicateResponse = duplicateStatusResponse(FINISHED_CONSUMER, context.eventId(), runId, command);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        RunResponse running = runService.markRunningIfStarting(runId);
        RunResponse run = runService.finishRun(running, command.stopped());
        return RunnerCallbackAckResponse.terminal(run);
    }

    @Transactional
    public RunnerCallbackAckResponse handleFailed(UUID runId, RunnerFailedCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());

        RunnerCallbackAckResponse duplicateResponse = duplicateStatusResponse(FAILED_CONSUMER, context.eventId(), runId, command);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        RunResponse run = runService.failRun(runId, command.failureCode(), command.failureMessage(), command.resultCompleteness());
        return RunnerCallbackAckResponse.terminal(run);
    }

    @Transactional
    public RunnerCallbackAckResponse handleAgentEvents(UUID runId, RunnerAgentEventsCommand command, InternalCallbackContext context) {
        context.validateRequired();

        if (isDuplicate(AGENT_EVENTS_CONSUMER, context.eventId(), runId, command)) {
            RunResponse run = runService.getRun(runId);
            return RunnerCallbackAckResponse.stepEvents(run, command.events().size()).withEventCount(command.events().size());
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        runPersistenceAdapter.saveAgentEvents(runId, command.events());
        command.events().forEach(event -> appendAgentRunEvent(runId, event));
        return RunnerCallbackAckResponse.stepEvents(run, command.events().size());
    }

    @Transactional
    public RunnerCallbackAckResponse handleAgentTrace(UUID runId, RunnerAgentTraceCommand command, InternalCallbackContext context) {
        context.validateRequired();

        if (isDuplicate(AGENT_TRACES_CONSUMER, context.eventId(), runId, command)) {
            return RunnerCallbackAckResponse.duplicateStatus(runService.getRun(runId));
        }

        RunResponse run = runService.markRunningIfStarting(runId);
        runPersistenceAdapter.saveAgentTrace(runId, command);
        return RunnerCallbackAckResponse.accepted(run);
    }

    @Transactional(readOnly = true)
    public RunnerControlStateResponse getControlState(UUID runId) {
        RunResponse run = runService.getRun(runId);
        return new RunnerControlStateResponse(
                run.id(),
                run.status(),
                run.status() == RunStatus.STOP_REQUESTED,
                run.resultCompleteness()
        );
    }

    private void applyStepEvent(UUID runId, RunnerStepEventCommand event) {
        RunPersistenceAdapter.ResolvedStep step = runPersistenceAdapter.resolveStep(runId, event.stepKey());
        runPersistenceAdapter.updateCurrentStepOrder(runId, step.stepOrder());
        runPersistenceAdapter.appendRunEvent(runId, step.id(), event.eventType(), event.payload(), event.occurredAt());

        StepStatus nextStatus = mapStepStatus(event.eventType());
        if (nextStatus != null) {
            runPersistenceAdapter.updateStepState(
                    step.id(),
                    nextStatus,
                    event.occurredAt(),
                    hasStepIssue(nextStatus) ? stepIssueCode(event.payload()) : null,
                    hasStepIssue(nextStatus) ? stepIssueMessage(event.payload()) : null
            );
        }
    }

    private void appendAgentRunEvent(UUID runId, RunnerAgentEventCommand event) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("agentEventId", event.eventId());
        payload.put("taskId", event.taskId().toString());
        payload.put("attemptId", event.attemptId().toString());
        payload.put("stepIndex", event.stepIndex());
        payload.put("agentEventType", event.eventType());
        payload.put("payload", event.payload());
        runPersistenceAdapter.appendRunEvent(runId, null, "AGENT_" + event.eventType(), payload, event.occurredAt());
    }

    private String stringPayloadValue(Map<String, Object> payload, String key) {
        Object value = payload == null ? null : payload.get(key);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private boolean hasStepIssue(StepStatus status) {
        return status == StepStatus.FAILED || status == StepStatus.BLOCKED;
    }

    private String stepIssueCode(Map<String, Object> payload) {
        String failureCode = stringPayloadValue(payload, "failureCode");
        if (failureCode != null) {
            return failureCode;
        }
        return stringPayloadValue(payload, "reasonCode");
    }

    private String stepIssueMessage(Map<String, Object> payload) {
        String failureMessage = stringPayloadValue(payload, "failureMessage");
        if (failureMessage != null) {
            return failureMessage;
        }
        return stringPayloadValue(payload, "reason");
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
            RunPersistenceAdapter.ResolvedStep step = runPersistenceAdapter.resolveOrCreateAgentStep(runId, checkpoint.stepKey(), checkpoint.stage());
            runPersistenceAdapter.updateCurrentStepOrder(runId, step.stepOrder());
            stepIdsByKey.put(checkpoint.stepKey(), step.id());
        }
        return stepIdsByKey;
    }

    private Map<String, UUID> resolveArtifactSteps(UUID runId, SaveRunArtifactsCommand command) {
        Map<String, UUID> stepIdsByKey = new LinkedHashMap<>();
        for (SaveRunArtifactCommand artifact : command.artifacts()) {
            if (isRunScopedAgentArtifact(artifact)) {
                continue;
            }
            RunPersistenceAdapter.ResolvedStep step = runPersistenceAdapter.resolveOrCreateAgentStep(runId, artifact.stepKey(), "VALUE");
            runPersistenceAdapter.updateCurrentStepOrder(runId, step.stepOrder());
            stepIdsByKey.put(artifact.stepKey(), step.id());
        }
        return stepIdsByKey;
    }


    private boolean isRunScopedAgentArtifact(SaveRunArtifactCommand artifact) {
        return RUN_SCOPED_AGENT_ARTIFACT_KEYS.contains(artifact.stepKey());
    }

    private StepStatus mapStepStatus(String eventType) {
        return switch (eventType) {
            case "STEP_STARTED" -> StepStatus.RUNNING;
            case "STEP_COMPLETED" -> StepStatus.PASSED;
            case "STEP_BLOCKED" -> StepStatus.BLOCKED;
            case "STEP_FAILED" -> StepStatus.FAILED;
            default -> null;
        };
    }

    private boolean isTerminalStatus(RunStatus status) {
        return status == RunStatus.COMPLETED || status == RunStatus.FAILED || status == RunStatus.STOPPED;
    }

    private void rejectTerminalEvidence(RunResponse run) {
        if (isTerminalStatus(run.status())) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Run evidence cannot be accepted after the run is terminal.");
        }
    }

    private boolean isDuplicate(String consumerName, String eventId, UUID runId, Object command) {
        return !processedMessagePersistenceAdapter.tryMarkProcessed(consumerName, eventId, idempotencyPayload(runId, command));
    }

    private RunnerCallbackAckResponse duplicateStatusResponse(String consumerName, String eventId, UUID runId, Object command) {
        if (!isDuplicate(consumerName, eventId, runId, command)) {
            return null;
        }

        return RunnerCallbackAckResponse.duplicateStatus(runService.getRun(runId));
    }

    private Map<String, Object> idempotencyPayload(UUID runId, Object command) {
        return Map.of(
                "runId", runId.toString(),
                "payload", command
        );
    }
}
