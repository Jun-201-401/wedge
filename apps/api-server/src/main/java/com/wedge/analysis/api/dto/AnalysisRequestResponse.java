package com.wedge.analysis.api.dto;

import java.util.UUID;

public record AnalysisRequestResponse(
        UUID analysisJobId,
        UUID runId,
        String status,
        String analysisType,
        UUID evidencePacketId,
        boolean evidencePacketIncluded,
        int checkpointCount,
        int artifactCount
) {
}
