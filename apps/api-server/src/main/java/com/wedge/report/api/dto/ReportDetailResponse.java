package com.wedge.report.api.dto;

import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ReportDetailResponse(
        UUID id,
        UUID runId,
        UUID analysisJobId,
        String title,
        ReportFormat format,
        ReportStatus status,
        BigDecimal frictionScore,
        Map<String, Object> summary,
        List<DecisionMapItemResponse> decisionMap,
        int initialDisplayCount,
        List<ReportDetailFindingResponse> findings,
        OffsetDateTime createdAt
) {
}
