package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunEventResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.api.dto.RunStepResponse;
import com.wedge.run.application.RunExecutionRequestSource;
import com.wedge.run.application.command.RunnerAgentEventCommand;
import com.wedge.run.application.command.RunnerAgentTraceCommand;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class RunPersistenceAdapter {
    private static final String RUN_TYPE = "run";
    private static final String RUNNER_EVENT_SOURCE = "RUNNER";
    private static final TypeReference<Map<String, Object>> JSON_MAP_TYPE = new TypeReference<>() {};

    private final RunMapper runMapper;
    private final ObjectMapper objectMapper;

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

    public List<RunStepResponse> listRunSteps(UUID runId) {
        return runMapper.findStepsByRunId(runId).stream()
                .map(this::toStepResponse)
                .toList();
    }

    public Optional<RunStepResponse> findRunStep(UUID runId, UUID stepId) {
        return runMapper.findStepByRunIdAndId(runId, stepId)
                .map(this::toStepResponse);
    }

    public List<RunEventResponse> listRunEvents(
            UUID runId,
            UUID stepId,
            String eventType,
            UUID cursorEventId,
            int limit
    ) {
        return runMapper.findEvents(runId, stepId, eventType, cursorEventId, limit).stream()
                .map(this::toEventResponse)
                .toList();
    }

    public Optional<RunExecutionRequestSource> findExecutionRequestSource(UUID runId) {
        return runMapper.findById(runId).map(this::toExecutionRequestSource);
    }

    public Optional<Map<String, Object>> findLatestSuccessfulAgentTraceForReplay(RunExecutionRequestSource source) {
        return runMapper.findLatestSuccessfulAgentTraceJsonForReplay(
                        source.projectId(),
                        source.startUrl().toString(),
                        source.goal(),
                        source.id()
                )
                .map(rawJson -> readJsonMap(rawJson, "Stored AgentTrace replay payload is invalid"));
    }

    public int nextAgentAttemptIndex(UUID runId) {
        return runMapper.countAgentTraces(runId) + 1;
    }

    public RunResponse createRun(RunCreateRequest request) {
        RunRecord record = RunRecord.created(request);
        Map<String, Object> scenarioPlan = request.scenarioPlan();
        record.setScenarioPlanSchemaVersion(resolveScenarioPlanSchemaVersion(scenarioPlan));
        record.setScenarioPlanJson(writeJsonOrEmpty(scenarioPlan));
        runMapper.insert(record);
        if (hasScenarioPlan(scenarioPlan)) {
            insertScenarioSteps(record.getId(), scenarioPlan);
        }
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
                .map(this::toResolvedStep)
                .orElseThrow(() -> missingStep(stepKey));
    }

    public ResolvedStep resolveOrCreateAgentStep(UUID runId, String stepKey, String stage) {
        return runMapper.findStepByRunIdAndStepKey(runId, stepKey)
                .map(this::toResolvedStep)
                .orElseGet(() -> createAgentStep(runId, stepKey, stage));
    }

    private ResolvedStep createAgentStep(UUID runId, String stepKey, String stage) {
        if (!stepKey.startsWith("agent_turn_")) {
            throw missingStep(stepKey);
        }

        RunStepRecord record = new RunStepRecord();
        record.setId(UUID.randomUUID());
        record.setRunId(runId);
        record.setStepOrder(resolveAgentStepOrder(stepKey));
        record.setStepKey(stepKey);
        record.setStepName("Agent turn " + record.getStepOrder());
        record.setStage(resolveAgentStage(stage));
        record.setStepType("CHECKPOINT");
        record.setStatus(StepStatus.PENDING);
        runMapper.insertStep(record);
        return toResolvedStep(record);
    }

    private ResolvedStep toResolvedStep(RunStepRecord step) {
        return new ResolvedStep(step.getId(), step.getStepOrder(), step.getStepKey(), step.getStatus());
    }

    private BusinessException missingStep(String stepKey) {
        return new BusinessException(
                ErrorCode.INVALID_REQUEST,
                "Runner callback step key was not found for the run: " + stepKey
        );
    }

    private int resolveAgentStepOrder(String stepKey) {
        String rawOrder = stepKey.substring("agent_turn_".length());
        try {
            int order = Integer.parseInt(rawOrder);
            return order > 0 ? order : 1;
        } catch (NumberFormatException ignored) {
            return 1;
        }
    }

    private String resolveAgentStage(String stage) {
        return switch (stage == null ? "" : stage) {
            case "FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT" -> stage;
            default -> "VALUE";
        };
    }

    public void updateCurrentStepOrder(UUID runId, int stepOrder) {
        runMapper.updateCurrentStepOrder(runId, stepOrder);
    }

    public void updateLatestArtifact(UUID runId, UUID artifactId) {
        runMapper.updateLatestArtifact(runId, artifactId);
    }

    public void updateLatestCheckpoint(UUID runId, UUID checkpointId) {
        runMapper.updateLatestCheckpoint(runId, checkpointId);
    }

    public void updateStepState(UUID stepId, StepStatus nextStatus, OffsetDateTime occurredAt) {
        updateStepState(stepId, nextStatus, occurredAt, null, null);
    }

    public void updateStepState(
            UUID stepId,
            StepStatus nextStatus,
            OffsetDateTime occurredAt,
            String errorCode,
            String errorMessage
    ) {
        OffsetDateTime startedAt = nextStatus == StepStatus.RUNNING ? occurredAt : null;
        OffsetDateTime finishedAt = switch (nextStatus) {
            case PASSED, FAILED, SKIPPED, BLOCKED, STOPPED -> occurredAt;
            default -> null;
        };
        runMapper.updateStepState(stepId, nextStatus, startedAt, finishedAt, errorCode, errorMessage);
    }

    public void appendRunEvent(UUID runId, UUID stepId, String eventType, Map<String, Object> payload, OffsetDateTime occurredAt) {
        runMapper.insertRunEvent(
                UUID.randomUUID(),
                runId,
                stepId,
                eventType,
                RUNNER_EVENT_SOURCE,
                writeJson(payload),
                occurredAt
        );
    }

    public int saveAgentEvents(UUID runId, List<RunnerAgentEventCommand> events) {
        int inserted = 0;
        for (RunnerAgentEventCommand event : events) {
            inserted += runMapper.insertAgentEvent(
                    UUID.randomUUID(),
                    runId,
                    event.taskId(),
                    event.attemptId(),
                    event.eventId(),
                    event.stepIndex(),
                    event.eventType(),
                    writeJson(event.payload()),
                    event.occurredAt()
            );
        }
        return inserted;
    }

    public int saveAgentTrace(UUID runId, RunnerAgentTraceCommand command) {
        Map<String, Object> trace = command.trace();
        OffsetDateTime finishedAt = optionalOffsetDateTime(trace, "finished_at");
        return runMapper.insertAgentTrace(
                UUID.randomUUID(),
                runId,
                resolveTraceId(runId, command),
                command.taskId(),
                command.attemptId(),
                resolveFinalOutcome(trace),
                writeJson(trace),
                optionalOffsetDateTime(trace, "started_at"),
                finishedAt == null ? command.occurredAt() : finishedAt
        );
    }

    private boolean hasScenarioPlan(Map<String, Object> scenarioPlan) {
        return scenarioPlan != null && !scenarioPlan.isEmpty();
    }

    private void insertScenarioSteps(UUID runId, Map<String, Object> scenarioPlan) {
        Object steps = scenarioPlan.get("steps");
        if (!(steps instanceof List<?> stepList) || stepList.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps must contain at least one step.");
        }

        for (int index = 0; index < stepList.size(); index++) {
            Map<String, Object> step = requireMap(stepList.get(index), "scenarioPlan.steps[" + index + "]");
            RunStepRecord record = new RunStepRecord();
            record.setId(UUID.randomUUID());
            record.setRunId(runId);
            record.setStepOrder(index + 1);
            record.setStepKey(requireNonBlankString(step, "step_id", "scenarioPlan.steps[" + index + "].step_id"));
            record.setStepName(requireNonBlankString(step, "description", "scenarioPlan.steps[" + index + "].description"));
            record.setStage(requireNonBlankString(step, "stage", "scenarioPlan.steps[" + index + "].stage"));
            record.setStepType(resolveStepType(step, index));
            record.setStatus(StepStatus.PENDING);
            runMapper.insertStep(record);
        }
    }

    private String resolveStepType(Map<String, Object> step, int index) {
        Map<String, Object> action = requireMap(step.get("action"), "scenarioPlan.steps[" + index + "].action");
        String actionType = requireNonBlankString(action, "type", "scenarioPlan.steps[" + index + "].action.type");
        return actionType.toUpperCase().replace('-', '_');
    }

    private Map<String, Object> requireMap(Object value, String name) {
        if (value instanceof Map<?, ?> rawMap) {
            @SuppressWarnings("unchecked")
            Map<String, Object> mapValue = (Map<String, Object>) rawMap;
            return mapValue;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, name + " must be an object.");
    }

    private String requireNonBlankString(Map<String, Object> source, String key, String name) {
        Object value = source.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, name + " is required.");
    }

    private UUID optionalUuid(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof UUID uuid) {
            return uuid;
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return UUID.fromString(text);
            } catch (IllegalArgumentException exception) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "AgentTrace." + key + " must be a UUID.", null, exception);
            }
        }
        return null;
    }

    private UUID resolveTraceId(UUID runId, RunnerAgentTraceCommand command) {
        UUID traceId = optionalUuid(command.trace(), "trace_id");
        if (traceId != null) {
            return traceId;
        }
        String stableSource = "runner-agent-trace:%s:%s:%s".formatted(runId, command.taskId(), command.attemptId());
        return UUID.nameUUIDFromBytes(stableSource.getBytes(StandardCharsets.UTF_8));
    }

    private String resolveFinalOutcome(Map<String, Object> trace) {
        String finalOutcome = optionalString(trace, "final_outcome");
        if (finalOutcome != null) {
            return finalOutcome;
        }
        Object outcome = trace.get("outcome");
        if (outcome instanceof Map<?, ?> outcomeMap) {
            Object status = outcomeMap.get("status");
            return status instanceof String text && !text.isBlank() ? text : null;
        }
        return null;
    }

    private String optionalString(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private OffsetDateTime optionalOffsetDateTime(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof OffsetDateTime timestamp) {
            return timestamp;
        }
        if (value instanceof String text && !text.isBlank()) {
            return OffsetDateTime.parse(text);
        }
        return null;
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

    private RunStepResponse toStepResponse(RunStepRecord record) {
        return new RunStepResponse(
                record.getId(),
                record.getRunId(),
                record.getStepOrder(),
                record.getStepKey(),
                record.getStepName(),
                record.getStepType(),
                record.getStatus(),
                record.getStartedAt(),
                record.getFinishedAt(),
                record.getErrorCode(),
                record.getErrorMessage()
        );
    }

    private RunEventResponse toEventResponse(RunEventRecord record) {
        return new RunEventResponse(
                record.getId(),
                record.getRunId(),
                record.getStepId(),
                record.getStepKey(),
                record.getEventType(),
                record.getSource(),
                readJsonMap(record.getPayloadJson(), "Stored run event payload is invalid"),
                record.getOccurredAt()
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
                readJsonMap(record.getScenarioPlanJson(), "Stored scenarioPlanJson is invalid")
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

    private Map<String, Object> readJsonMap(String rawJson, String invalidMessage) {
        if (rawJson == null || rawJson.isBlank()) {
            throw new IllegalStateException(invalidMessage);
        }

        try {
            return objectMapper.readValue(rawJson, JSON_MAP_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(invalidMessage, exception);
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
