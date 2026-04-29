package com.wedge.evidence.api.dto;

public record RunEvidenceSummaryResponse(
        LatestCheckpointResponse latestCheckpoint,
        ArtifactResponse latestArtifact,
        ArtifactResponse latestFrameArtifact,
        EvidenceCountsResponse evidenceCounts
) {
}
