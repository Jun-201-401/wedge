package com.wedge.evidence.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class Checkpoint {
    private UUID id;
    private UUID runId;
    private UUID stepId;
    private String stepKey;
    private String checkpointKey;
    private String stage;
    private String triggerJsonb;
    private String settleJsonb;
    private String stateJsonb;
    private String deltaJsonb;
    private String artifactRefsJsonb;
    private OffsetDateTime capturedAt;
    private Integer durationMs;
    private OffsetDateTime createdAt;
}
