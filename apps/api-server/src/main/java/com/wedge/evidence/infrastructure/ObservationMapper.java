package com.wedge.evidence.infrastructure;

import com.wedge.evidence.domain.Observation;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.UUID;

@Mapper
public interface ObservationMapper {
    List<Observation> findByRunId(@Param("runId") UUID runId);

    List<Observation> findByDiscoveryId(@Param("discoveryId") UUID discoveryId);

    List<Observation> findByCheckpointId(@Param("checkpointId") UUID checkpointId);

    int insert(Observation observation);
}
