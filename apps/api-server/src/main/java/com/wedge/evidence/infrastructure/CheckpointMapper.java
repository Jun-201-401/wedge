package com.wedge.evidence.infrastructure;

import com.wedge.evidence.domain.Checkpoint;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CheckpointMapper {
    Optional<Checkpoint> findById(@Param("id") UUID id);

    Optional<Checkpoint> findByRunIdAndCheckpointKey(
            @Param("runId") UUID runId,
            @Param("checkpointKey") String checkpointKey
    );

    Optional<Checkpoint> findByDiscoveryIdAndCheckpointKey(
            @Param("discoveryId") UUID discoveryId,
            @Param("checkpointKey") String checkpointKey
    );

    List<Checkpoint> findByRunId(@Param("runId") UUID runId);

    List<Checkpoint> findByDiscoveryId(@Param("discoveryId") UUID discoveryId);

    int insert(Checkpoint checkpoint);

    int insertDiscovery(Checkpoint checkpoint);
}
