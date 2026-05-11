package com.wedge.report.api.dto;

import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

public record ReportExportResponse(
        UUID reportId,
        UUID runId,
        UUID analysisJobId,
        ReportFormat format,
        ReportStatus status,
        UUID artifactId,
        String downloadUrl,
        OffsetDateTime createdAt
) {
}
