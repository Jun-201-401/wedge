package com.wedge.mcp.api.dto;

import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

public record GetRunStatusResponse(
        UUID runId,
        UUID projectId,
        String name,
        String triggerSource,
        String startUrl,
        String goal,
        String devicePreset,
        UUID scenarioTemplateVersionId,
        RunStatus status,
        ResultCompleteness resultCompleteness,
        AnalysisStatus analysisStatus,
        Integer currentStepOrder,
        OffsetDateTime startedAt,
        OffsetDateTime finishedAt,
        Failure failure
) {
    public static GetRunStatusResponse from(RunResponse run) {
        Failure failure = run.failureCode() == null && run.failureMessage() == null
                ? null
                : new Failure(run.failureCode(), run.failureMessage());

        return new GetRunStatusResponse(
                run.id(),
                run.projectId(),
                run.name(),
                run.triggerSource(),
                run.startUrl().toString(),
                run.goal(),
                run.devicePreset(),
                run.scenarioTemplateVersionId(),
                run.status(),
                run.resultCompleteness(),
                run.analysisStatus(),
                run.currentStepOrder(),
                run.startedAt(),
                run.finishedAt(),
                failure
        );
    }

    public record Failure(String code, String message) {
    }
}
