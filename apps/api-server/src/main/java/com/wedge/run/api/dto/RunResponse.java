package com.wedge.run.api.dto;

import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.UUID;

public record RunResponse(
        UUID id,
        String type,
        UUID projectId,
        String name,
        String triggerSource,
        URI startUrl,
        String goal,
        String devicePreset,
        UUID scenarioTemplateVersionId,
        RunStatus status,
        ResultCompleteness resultCompleteness,
        AnalysisStatus analysisStatus,
        Integer currentStepOrder,
        OffsetDateTime startedAt,
        OffsetDateTime finishedAt,
        String failureCode,
        String failureMessage,
        LatestSnapshotResponse latestSnapshot
) {

    public static RunResponse created(RunCreateRequest request) {
        return new RunResponse(
                UUID.randomUUID(),
                "run",
                request.projectId(),
                request.name(),
                "WEB",
                request.startUrl(),
                request.goal(),
                request.devicePreset(),
                request.scenarioTemplateVersionId(),
                RunStatus.CREATED,
                ResultCompleteness.NONE,
                AnalysisStatus.NOT_STARTED,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }

    public RunResponse withExecutionState(RunStatus nextStatus, ResultCompleteness nextResultCompleteness) {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime nextStartedAt = startedAt;
        OffsetDateTime nextFinishedAt = finishedAt;

        if ((nextStatus == RunStatus.STARTING || nextStatus == RunStatus.RUNNING) && nextStartedAt == null) {
            nextStartedAt = now;
        }

        if (nextStatus == RunStatus.STOPPED || nextStatus == RunStatus.COMPLETED || nextStatus == RunStatus.FAILED) {
            nextFinishedAt = now;
        }

        return new RunResponse(
                id,
                type,
                projectId,
                name,
                triggerSource,
                startUrl,
                goal,
                devicePreset,
                scenarioTemplateVersionId,
                nextStatus,
                nextResultCompleteness,
                analysisStatus,
                currentStepOrder,
                nextStartedAt,
                nextFinishedAt,
                failureCode,
                failureMessage,
                latestSnapshot
        );
    }

    public RunResponse withFailure(String nextFailureCode, String nextFailureMessage, ResultCompleteness nextResultCompleteness) {
        return new RunResponse(
                id,
                type,
                projectId,
                name,
                triggerSource,
                startUrl,
                goal,
                devicePreset,
                scenarioTemplateVersionId,
                RunStatus.FAILED,
                nextResultCompleteness,
                analysisStatus,
                currentStepOrder,
                startedAt,
                OffsetDateTime.now(),
                nextFailureCode,
                nextFailureMessage,
                latestSnapshot
        );
    }
}
