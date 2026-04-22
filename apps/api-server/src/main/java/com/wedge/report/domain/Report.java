package com.wedge.report.domain;

import com.wedge.run.domain.ReportStatus;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
public class Report {
    private UUID id;
    private UUID runId;
    private UUID analysisJobId;
    private String title;
    private ReportFormat format;
    private ReportStatus status;
    private String summaryJsonb;
    private String decisionMapJsonb;
    private UUID artifactId;
    private UUID createdBy;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private OffsetDateTime deletedAt;
    private long version;
}
