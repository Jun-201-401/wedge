package com.wedge.scenarioauthoring.infrastructure;

import com.wedge.scenarioauthoring.domain.ScenarioAuthoringJob;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ScenarioAuthoringJobMapper {
    Optional<ScenarioAuthoringJob> findById(@Param("id") UUID id);

    Optional<ScenarioAuthoringJob> findByIdempotencyKey(
            @Param("projectId") UUID projectId,
            @Param("createdBy") UUID createdBy,
            @Param("idempotencyKey") String idempotencyKey
    );

    int insert(ScenarioAuthoringJob job);

    int confirmCandidate(
            @Param("id") UUID id,
            @Param("confirmedCandidateId") String confirmedCandidateId,
            @Param("confirmedBy") UUID confirmedBy
    );
}
