package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.OutboxMessagePersistenceAdapter;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunService {
    private final RunPersistenceAdapter runPersistenceAdapter;
    private final RunExecuteRequestMessageFactory runExecuteRequestMessageFactory;
    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final ApplicationEventPublisher applicationEventPublisher;

    public RunService(
            RunPersistenceAdapter runPersistenceAdapter,
            RunExecuteRequestMessageFactory runExecuteRequestMessageFactory,
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            ApplicationEventPublisher applicationEventPublisher
    ) {
        this.runPersistenceAdapter = runPersistenceAdapter;
        this.runExecuteRequestMessageFactory = runExecuteRequestMessageFactory;
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.applicationEventPublisher = applicationEventPublisher;
    }

    @Transactional(readOnly = true)
    public List<RunResponse> listRuns(UUID projectId, RunStatus status) {
        return runPersistenceAdapter.listRuns(projectId, status);
    }

    @Transactional
    public RunResponse createRun(RunCreateRequest request) {
        validateScenarioPlan(request);
        return runPersistenceAdapter.createRun(request);
    }

    @Transactional(readOnly = true)
    public RunResponse getRun(UUID runId) {
        return runPersistenceAdapter.findRun(runId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND));
    }

    @Transactional
    public void deleteRun(UUID runId) {
        if (!runPersistenceAdapter.softDeleteRun(runId)) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND);
        }
    }

    @Transactional
    public RunResponse startRun(UUID runId) {
        RunResponse current = getRun(runId);
        RunExecutionRequestSource executionRequestSource = runPersistenceAdapter.findExecutionRequestSource(runId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND));
        RunStatusTransitionPolicy.validateTransition(current.status(), RunStatus.QUEUED);

        RunResponse queued = runPersistenceAdapter.updateExecutionState(current, RunStatus.QUEUED, ResultCompleteness.NONE);
        RunExecuteRequestMessage message = runExecuteRequestMessageFactory.create(executionRequestSource);
        UUID outboxMessageId = outboxMessagePersistenceAdapter.appendRunExecuteMessage(message);
        applicationEventPublisher.publishEvent(new RunExecuteOutboxEnqueuedEvent(outboxMessageId));
        return queued;
    }

    @Transactional
    public RunResponse markAccepted(UUID runId) {
        return transition(runId, RunStatus.STARTING, ResultCompleteness.NONE);
    }

    @Transactional
    public RunResponse stopRun(UUID runId) {
        return transition(runId, RunStatus.STOP_REQUESTED, ResultCompleteness.PARTIAL);
    }

    @Transactional
    public RunResponse markRunningIfStarting(UUID runId) {
        RunResponse current = getRun(runId);
        if (current.status() == RunStatus.STARTING) {
            return transition(current, RunStatus.RUNNING, ResultCompleteness.NONE);
        }
        return current;
    }

    @Transactional
    public RunResponse finishRun(UUID runId, boolean stopped) {
        if (stopped) {
            return transition(runId, RunStatus.STOPPED, ResultCompleteness.PARTIAL);
        }
        return transition(runId, RunStatus.COMPLETED, ResultCompleteness.FINAL);
    }

    @Transactional
    public RunResponse failRun(UUID runId, String failureCode, String failureMessage, ResultCompleteness resultCompleteness) {
        RunResponse current = getRun(runId);
        RunStatusTransitionPolicy.validateTransition(current.status(), RunStatus.FAILED);
        return runPersistenceAdapter.updateFailureState(current, failureCode, failureMessage, resultCompleteness);
    }

    private RunResponse transition(UUID runId, RunStatus nextStatus, ResultCompleteness resultCompleteness) {
        return transition(getRun(runId), nextStatus, resultCompleteness);
    }

    private RunResponse transition(RunResponse current, RunStatus nextStatus, ResultCompleteness resultCompleteness) {
        RunStatusTransitionPolicy.validateTransition(current.status(), nextStatus);
        return runPersistenceAdapter.updateExecutionState(current, nextStatus, resultCompleteness);
    }

    private void validateScenarioPlan(RunCreateRequest request) {
        Map<String, Object> scenarioPlan = request.scenarioPlan();
        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan is required.");
        }

        requireNonBlankString(scenarioPlan, "schema_version");
        requireNonBlankString(scenarioPlan, "plan_id");
        requireNonBlankString(scenarioPlan, "scenario_type");

        String planStartUrl = requireNonBlankString(scenarioPlan, "start_url");
        if (!request.startUrl().toString().equals(planStartUrl)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.start_url must match startUrl.");
        }

        Map<String, Object> environment = requireMap(scenarioPlan, "environment");
        String planDevice = requireNonBlankString(environment, "device");
        if (!request.devicePreset().equals(planDevice)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.environment.device must match devicePreset.");
        }

        Object steps = scenarioPlan.get("steps");
        if (!(steps instanceof List<?> stepList) || stepList.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps must contain at least one step.");
        }
    }

    private Map<String, Object> requireMap(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof Map<?, ?> rawMap) {
            @SuppressWarnings("unchecked")
            Map<String, Object> mapValue = (Map<String, Object>) rawMap;
            return mapValue;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan." + key + " must be an object.");
    }

    private String requireNonBlankString(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan." + key + " is required.");
    }
}
