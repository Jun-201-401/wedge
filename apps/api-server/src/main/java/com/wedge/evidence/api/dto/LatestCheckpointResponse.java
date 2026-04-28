package com.wedge.evidence.api.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record LatestCheckpointResponse(
        String checkpointId,
        UUID stepId,
        String stage,
        String url,
        OffsetDateTime capturedAt,
        Integer durationMs,
        int observationCount,
        int artifactRefCount
) {
}
