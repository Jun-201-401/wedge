package com.wedge.evidence.api.dto;

public record EvidenceCountsResponse(
        int checkpointCount,
        int observationCount,
        int artifactCount
) {
}
