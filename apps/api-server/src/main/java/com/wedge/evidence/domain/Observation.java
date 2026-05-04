package com.wedge.evidence.domain;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
public class Observation {
    private UUID id;
    private UUID checkpointId;
    private UUID runId;
    private UUID discoveryId;
    private String observationKey;
    private String observationType;
    private String stage;
    private String sourcesJsonb;
    private String dataJsonb;
    private BigDecimal confidence;
    private OffsetDateTime createdAt;
}
