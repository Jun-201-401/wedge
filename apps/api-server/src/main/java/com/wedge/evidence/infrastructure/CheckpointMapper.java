package com.wedge.evidence.infrastructure;

import com.wedge.evidence.domain.Checkpoint;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Mapper
public interface CheckpointMapper {
    Optional<Checkpoint> findById(@Param("id") UUID id);
    Optional<Checkpoint> findByRunIdAndCheckpointKey(
            @Param("runId") UUID runId,
            @Param("checkpointKey") String checkpointKey
    );
    List<Checkpoint> findByRunId(@Param("runId") UUID runId);
    int insert(Checkpoint checkpoint);
}
