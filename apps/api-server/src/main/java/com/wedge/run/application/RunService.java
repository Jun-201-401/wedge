package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class RunService {
    private final Map<UUID, RunResponse> runs = new ConcurrentHashMap<>();

    public List<RunResponse> listRuns(UUID projectId, RunStatus status) {
        return runs.values().stream()
                .filter(run -> projectId == null || run.projectId().equals(projectId))
                .filter(run -> status == null || run.status() == status)
                .sorted(Comparator.comparing(RunResponse::name))
                .toList();
    }

    public RunResponse createRun(RunCreateRequest request) {
        RunResponse run = RunResponse.created(request);
        runs.put(run.id(), run);
        return run;
    }

    public RunResponse getRun(UUID runId) {
        RunResponse run = runs.get(runId);
        if (run == null) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND);
        }
        return run;
    }

    public void deleteRun(UUID runId) {
        if (runs.remove(runId) == null) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND);
        }
    }

    public RunResponse startRun(UUID runId) {
        return transition(runId, RunStatus.QUEUED, ResultCompleteness.NONE);
    }

    public RunResponse markAccepted(UUID runId) {
        return transition(runId, RunStatus.STARTING, ResultCompleteness.NONE);
    }

    public RunResponse stopRun(UUID runId) {
        return transition(runId, RunStatus.STOP_REQUESTED, ResultCompleteness.PARTIAL);
    }

    public RunResponse markRunningIfStarting(UUID runId) {
        RunResponse current = getRun(runId);
        if (current.status() == RunStatus.STARTING) {
            return transition(runId, RunStatus.RUNNING, ResultCompleteness.NONE);
        }
        return current;
    }

    public RunResponse finishRun(UUID runId, boolean stopped) {
        if (stopped) {
            return transition(runId, RunStatus.STOPPED, ResultCompleteness.PARTIAL);
        }
        return transition(runId, RunStatus.COMPLETED, ResultCompleteness.FINAL);
    }

    public RunResponse failRun(UUID runId, String failureCode, String failureMessage, ResultCompleteness resultCompleteness) {
        return runs.compute(runId, (id, current) -> {
            if (current == null) {
                throw new BusinessException(ErrorCode.RUN_NOT_FOUND);
            }
            RunStatusTransitionPolicy.validateTransition(current.status(), RunStatus.FAILED);
            return current.withFailure(failureCode, failureMessage, resultCompleteness);
        });
    }

    private RunResponse transition(UUID runId, RunStatus nextStatus, ResultCompleteness resultCompleteness) {
        return runs.compute(runId, (id, current) -> {
            if (current == null) {
                throw new BusinessException(ErrorCode.RUN_NOT_FOUND);
            }
            RunStatusTransitionPolicy.validateTransition(current.status(), nextStatus);
            return current.withExecutionState(nextStatus, resultCompleteness);
        });
    }
}
