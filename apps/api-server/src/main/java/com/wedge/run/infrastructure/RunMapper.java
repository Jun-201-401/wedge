package com.wedge.run.infrastructure;

import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
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

    int softDelete(@Param("runId") UUID runId);
}
