package com.wedge.evidence.infrastructure;

import com.wedge.evidence.domain.Artifact;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Mapper
public interface ArtifactMapper {
    Optional<Artifact> findById(@Param("id") UUID id);
    Optional<Artifact> findByRunIdAndId(@Param("runId") UUID runId, @Param("id") UUID id);
    Optional<Artifact> findLatestScreenshotByRunIdAndStage(@Param("runId") UUID runId, @Param("stage") String stage);
    Optional<Artifact> findLatestScreenshotByRunId(@Param("runId") UUID runId);
    List<Artifact> findByRunId(@Param("runId") UUID runId);
    int insert(Artifact artifact);
}
