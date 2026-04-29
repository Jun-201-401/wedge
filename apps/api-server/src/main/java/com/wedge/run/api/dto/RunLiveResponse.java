package com.wedge.run.api.dto;

import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.api.dto.EvidenceCountsResponse;
import com.wedge.evidence.api.dto.LatestCheckpointResponse;
import com.wedge.run.domain.RunStatus;
import java.util.UUID;

public record RunLiveResponse(
        UUID runId,
        RunStatus status,
        Integer currentStepOrder,
        String currentAction,
        LatestSnapshotResponse latestFrame,
        LatestCheckpointResponse latestCheckpoint,
        ArtifactResponse latestArtifact,
        EvidenceCountsResponse evidenceCounts
) {
}
