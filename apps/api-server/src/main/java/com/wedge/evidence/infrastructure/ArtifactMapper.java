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
    List<Artifact> findByRunId(@Param("runId") UUID runId);
    int insert(Artifact artifact);
}
