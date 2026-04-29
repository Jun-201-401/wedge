package com.wedge.analysis.domain;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class RuleHit {
    private UUID id;
    private UUID analysisJobId;
    private UUID runId;
    private String criterionId;
    private String stage;
    private String axis;
    private Integer severity;
    private BigDecimal confidence;
    private BigDecimal priorityScore;
    private String evidenceLevel;
    private String evidenceRefsJsonb;
    private String observationsJsonb;
    private String signalsJsonb;
    private String exceptionsJsonb;
    private OffsetDateTime createdAt;
}
