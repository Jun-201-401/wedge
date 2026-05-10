package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunEventResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.api.dto.RunStepResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunService {
    private static final int DEFAULT_EVENT_LIMIT = 20;
    private static final int MAX_EVENT_LIMIT = 100;

    private final RunPersistenceAdapter runPersistenceAdapter;
    private final RunExecuteRequestMessageFactory runExecuteRequestMessageFactory;
    private final AgentExecuteRequestMessageFactory agentExecuteRequestMessageFactory;
    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final ApplicationEventPublisher applicationEventPublisher;
    private final ScenarioPlanValidator scenarioPlanValidator;

    @Transactional(readOnly = true)
    public List<RunResponse> listRuns(UUID projectId, RunStatus status) {
        return runPersistenceAdapter.listRuns(projectId, status);
    }

    @Transactional
    public RunResponse createRun(RunCreateRequest request) {
        scenarioPlanValidator.validateCreateRequest(request);
        return runPersistenceAdapter.createRun(request);
    }

    @Transactional(readOnly = true)
    public RunResponse getRun(UUID runId) {
        return runPersistenceAdapter.findRun(runId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND));
    }

    @Transactional(readOnly = true)
    public List<RunStepResponse> listRunSteps(UUID runId) {
        getRun(runId);
        return runPersistenceAdapter.listRunSteps(runId);
    }

    @Transactional(readOnly = true)
    public RunStepResponse getRunStep(UUID runId, UUID stepId) {
        getRun(runId);
        return runPersistenceAdapter.findRunStep(runId, stepId)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_REQUEST, "Run step was not found for the run."));
    }

    @Transactional(readOnly = true)
    public RunEventListResult listRunEvents(UUID runId, UUID stepId, String eventType, String cursor, Integer limit) {
        getRun(runId);

        int pageLimit = normalizeEventLimit(limit);
        List<RunEventResponse> fetchedEvents = runPersistenceAdapter.listRunEvents(
                runId,
                stepId,
                normalizeEventType(eventType),
                parseEventCursor(cursor),
                pageLimit + 1
        );
        boolean hasMore = fetchedEvents.size() > pageLimit;
        List<RunEventResponse> events = hasMore
                ? fetchedEvents.subList(0, pageLimit)
                : fetchedEvents;
        String nextCursor = hasMore && !events.isEmpty()
                ? events.get(events.size() - 1).id().toString()
                : null;
        return new RunEventListResult(events, nextCursor, hasMore);
    }

    private int normalizeEventLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_EVENT_LIMIT;
        }
        if (limit < 1 || limit > MAX_EVENT_LIMIT) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Run event limit must be between 1 and 100.");
        }
        return limit;
    }

    private String normalizeEventType(String eventType) {
        return eventType == null || eventType.isBlank() ? null : eventType.trim();
    }

    private UUID parseEventCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(cursor.trim());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Run event cursor must be an event id UUID.");
        }
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
    public RunResponse startAgentRun(UUID runId) {
        RunResponse current = getRun(runId);
        RunExecutionRequestSource executionRequestSource = runPersistenceAdapter.findExecutionRequestSource(runId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND));
        RunStatusTransitionPolicy.validateTransition(current.status(), RunStatus.QUEUED);

        RunResponse queued = runPersistenceAdapter.updateExecutionState(current, RunStatus.QUEUED, ResultCompleteness.NONE);
        AgentExecuteRequestMessage message = agentExecuteRequestMessageFactory.create(
                executionRequestSource,
                runPersistenceAdapter.findLatestSuccessfulAgentTraceForReplay(executionRequestSource),
                runPersistenceAdapter.nextAgentAttemptIndex(runId)
        );
        UUID outboxMessageId = outboxMessagePersistenceAdapter.appendAgentExecuteMessage(message);
        applicationEventPublisher.publishEvent(new AgentExecuteOutboxEnqueuedEvent(outboxMessageId));
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
}
