package com.wedge.run.infrastructure;

import com.wedge.run.domain.AnalysisStatus;
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

    Optional<RunRecord> findByIdempotencyKey(
            @Param("projectId") UUID projectId,
            @Param("createdBy") UUID createdBy,
            @Param("idempotencyKey") String idempotencyKey
    );

    List<RunStepRecord> findStepsByRunId(@Param("runId") UUID runId);

    Optional<RunStepRecord> findStepByRunIdAndId(@Param("runId") UUID runId, @Param("stepId") UUID stepId);

    Optional<RunStepRecord> findStepByRunIdAndStepKey(@Param("runId") UUID runId, @Param("stepKey") String stepKey);

    List<RunEventRecord> findEvents(
            @Param("runId") UUID runId,
            @Param("stepId") UUID stepId,
            @Param("eventType") String eventType,
            @Param("cursorEventId") UUID cursorEventId,
            @Param("limit") int limit
    );

    int insert(RunRecord run);

    int insertStep(RunStepRecord step);

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

    int updateLatestReport(@Param("runId") UUID runId, @Param("reportId") UUID reportId);

    int markAnalysisQueued(
            @Param("runId") UUID runId,
            @Param("analysisJobId") UUID analysisJobId
    );

    int updateCurrentAnalysisState(
            @Param("runId") UUID runId,
            @Param("analysisStatus") AnalysisStatus analysisStatus,
            @Param("analysisJobId") UUID analysisJobId,
            @Param("frictionScore") java.math.BigDecimal frictionScore,
            @Param("reportId") UUID reportId
    );

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

    int insertAgentEvent(
            @Param("id") UUID id,
            @Param("runId") UUID runId,
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("agentEventId") String agentEventId,
            @Param("stepIndex") int stepIndex,
            @Param("eventType") String eventType,
            @Param("payloadJson") String payloadJson,
            @Param("occurredAt") OffsetDateTime occurredAt
    );

    Optional<String> findLatestSuccessfulAgentTraceJsonForReplay(
            @Param("projectId") UUID projectId,
            @Param("startUrl") String startUrl,
            @Param("goal") String goal,
            @Param("excludeRunId") UUID excludeRunId
    );

    int countAgentTraces(@Param("runId") UUID runId);

    int insertAgentTrace(
            @Param("id") UUID id,
            @Param("runId") UUID runId,
            @Param("traceId") UUID traceId,
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("finalOutcome") String finalOutcome,
            @Param("traceJson") String traceJson,
            @Param("startedAt") OffsetDateTime startedAt,
            @Param("finishedAt") OffsetDateTime finishedAt
    );

    int softDelete(@Param("runId") UUID runId);
}
