package com.wedge.analysis.domain;

import com.wedge.run.domain.AnalysisJobStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class AnalysisJob {
    private UUID id;
    private UUID runId;
    private String jobType;
    private AnalysisJobStatus status;
    private UUID evidencePacketId;
    private UUID ruleRegistryId;
    private String judgeSchemaVersion;
    private String analyzerVersion;
    private String promptVersion;
    private String modelInfoJsonb;
    private String outputJsonb;
    private BigDecimal frictionScore;
    private OffsetDateTime createdAt;
    private OffsetDateTime startedAt;
    private OffsetDateTime finishedAt;
    private String errorCode;
    private String errorMessage;
}
