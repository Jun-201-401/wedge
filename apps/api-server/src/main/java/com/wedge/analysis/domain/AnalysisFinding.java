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
public class AnalysisFinding {
    private UUID id;
    private UUID analysisJobId;
    private UUID runId;
    private Integer rankOrder;
    private String title;
    private String summary;
    private String category;
    private String stage;
    private String axis;
    private Integer severity;
    private BigDecimal confidence;
    private BigDecimal priorityScore;
    private String impactHypothesis;
    private String evidenceRefsJsonb;
    private String referencesJsonb;
    private OffsetDateTime createdAt;
}
