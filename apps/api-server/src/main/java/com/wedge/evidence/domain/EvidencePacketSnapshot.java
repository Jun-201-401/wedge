package com.wedge.evidence.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class EvidencePacketSnapshot {
    private UUID id;
    private String executionType;
    private UUID runId;
    private UUID discoveryId;
    private String schemaVersion;
    private String packetJsonb;
    private int checkpointCount;
    private int observationCount;
    private int artifactCount;
    private OffsetDateTime createdAt;
}
