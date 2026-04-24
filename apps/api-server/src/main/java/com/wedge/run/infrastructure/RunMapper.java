package com.wedge.run.infrastructure;

import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface RunMapper {
    List<RunRecord> findAll(@Param("projectId") UUID projectId, @Param("status") RunStatus status);

    Optional<RunRecord> findById(@Param("runId") UUID runId);

    Optional<RunStepRecord> findStepByRunIdAndStepKey(@Param("runId") UUID runId, @Param("stepKey") String stepKey);

    int insert(RunRecord run);

    int updateExecutionState(
            @Param("runId") UUID runId,
            @Param("expectedStatus") RunStatus expectedStatus,
            @Param("nextStatus") RunStatus nextStatus,
            @Param("resultCompleteness") ResultCompleteness resultCompleteness,
            @Param("startedAt") OffsetDateTime startedAt,
            @Param("finishedAt") OffsetDateTime finishedAt
    );

    int updateFailureState(
            @Param("runId") UUID runId,
            @Param("expectedStatus") RunStatus expectedStatus,
            @Param("resultCompleteness") ResultCompleteness resultCompleteness,
            @Param("finishedAt") OffsetDateTime finishedAt,
            @Param("failureCode") String failureCode,
            @Param("failureMessage") String failureMessage
    );

    int updateCurrentStepOrder(@Param("runId") UUID runId, @Param("currentStepOrder") Integer currentStepOrder);

    int updateLatestArtifact(@Param("runId") UUID runId, @Param("artifactId") UUID artifactId);

    int updateLatestCheckpoint(@Param("runId") UUID runId, @Param("checkpointId") UUID checkpointId);

    int updateStepState(
            @Param("stepId") UUID stepId,
            @Param("nextStatus") StepStatus nextStatus,
            @Param("startedAt") OffsetDateTime startedAt,
            @Param("finishedAt") OffsetDateTime finishedAt,
            @Param("errorCode") String errorCode,
            @Param("errorMessage") String errorMessage
    );

    int insertRunEvent(
            @Param("id") UUID id,
            @Param("runId") UUID runId,
            @Param("stepId") UUID stepId,
            @Param("eventType") String eventType,
            @Param("source") String source,
            @Param("payloadJson") String payloadJson,
            @Param("occurredAt") OffsetDateTime occurredAt
    );

    int softDelete(@Param("runId") UUID runId);
}
