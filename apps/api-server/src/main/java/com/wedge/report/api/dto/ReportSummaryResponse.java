package com.wedge.report.api.dto;

import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record ReportSummaryResponse(
        UUID id,
        UUID runId,
        UUID analysisJobId,
        String title,
        ReportFormat format,
        ReportStatus status,
        BigDecimal frictionScore,
        Object summary,
        Object decisionMap,
        List<ReportTopFindingResponse> topFindings,
        OffsetDateTime createdAt
) {
}
