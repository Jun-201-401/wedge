package com.wedge.discovery.domain;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class ScenarioRecommendation {
    private UUID id;
    private UUID discoveryId;
    private String scenarioType;
    private String recommendationLevel;
    private BigDecimal confidence;
    private String reason;
    private String evidenceRefsJsonb;
    private String suggestedStartUrl;
    private String suggestedTargetJsonb;
    private OffsetDateTime createdAt;
}
