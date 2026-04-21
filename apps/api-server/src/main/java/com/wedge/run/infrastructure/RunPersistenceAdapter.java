package com.wedge.run.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RunPersistenceAdapter {
    private static final String RUN_TYPE = "run";

    private final RunMapper runMapper;

    public RunPersistenceAdapter(RunMapper runMapper) {
        this.runMapper = runMapper;
    }

    public List<RunResponse> listRuns(UUID projectId, RunStatus status) {
        return runMapper.findAll(projectId, status).stream()
                .map(this::toResponse)
                .toList();
    }

    public Optional<RunResponse> findRun(UUID runId) {
        return runMapper.findById(runId).map(this::toResponse);
    }

    public RunResponse createRun(RunCreateRequest request) {
        RunRecord record = RunRecord.created(request);
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

    private BusinessException stateConflict(RunStatus from, RunStatus to) {
        return new BusinessException(ErrorCode.STATE_CONFLICT, "Run state changed during transition: " + from + " -> " + to);
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
}
