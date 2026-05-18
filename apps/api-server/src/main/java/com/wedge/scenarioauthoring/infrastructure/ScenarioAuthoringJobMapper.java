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

    int markRunning(@Param("id") UUID id);

    int completeFromRunner(
            @Param("id") UUID id,
            @Param("status") String status,
            @Param("providerTraceJsonb") String providerTraceJsonb,
            @Param("candidatesJsonb") String candidatesJsonb,
            @Param("validationJsonb") String validationJsonb,
            @Param("provenanceJsonb") String provenanceJsonb,
            @Param("failureJsonb") String failureJsonb
    );

    int failFromRunner(
            @Param("id") UUID id,
            @Param("providerTraceJsonb") String providerTraceJsonb,
            @Param("validationJsonb") String validationJsonb,
            @Param("provenanceJsonb") String provenanceJsonb,
            @Param("failureJsonb") String failureJsonb
    );

    int failBeforeRunner(
            @Param("id") UUID id,
            @Param("providerTraceJsonb") String providerTraceJsonb,
            @Param("validationJsonb") String validationJsonb,
            @Param("provenanceJsonb") String provenanceJsonb,
            @Param("failureJsonb") String failureJsonb
    );

    int confirmCandidate(
            @Param("id") UUID id,
            @Param("confirmedCandidateId") String confirmedCandidateId,
            @Param("confirmedBy") UUID confirmedBy
    );
}
