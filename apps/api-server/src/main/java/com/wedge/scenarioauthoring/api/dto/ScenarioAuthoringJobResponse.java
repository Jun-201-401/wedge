package com.wedge.scenarioauthoring.api.dto;

import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ScenarioAuthoringJobResponse(
        String schemaVersion,
        UUID authoringJobId,
        ScenarioAuthoringStatus status,
        UUID projectId,
        UUID sourceDiscoveryId,
        String correlationId,
        int candidateCount,
        List<String> providerOrder,
        Map<String, Object> input,
        Map<String, Object> providerPolicy,
        List<Map<String, Object>> providerTrace,
        List<Map<String, Object>> candidates,
        Map<String, Object> validation,
        Map<String, Object> provenance,
        Map<String, Object> failure,
        String confirmedCandidateId,
        UUID confirmedBy,
        OffsetDateTime confirmedAt,
        UUID materializedRunId,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime expiresAt
) {
}
