package com.wedge.analysis.infrastructure;

import com.wedge.analysis.domain.AnalysisJob;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AnalysisJobMapper {
    Optional<AnalysisJob> findById(@Param("id") UUID id);

    Optional<AnalysisJob> findLatestByRunId(@Param("runId") UUID runId);

    Optional<AnalysisJob> findLatestCompletedByRunId(@Param("runId") UUID runId);

    int insertQueued(AnalysisJob analysisJob);

    int upsertCompleted(AnalysisJob analysisJob);

    int upsertFailed(AnalysisJob analysisJob);
}
