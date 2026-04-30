package com.wedge.report.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record RunReportResponse(
        UUID runId,
        String reportStatus,
        String analysisStatus,
        UUID analysisJobId,
        UUID reportId,
        String title,
        ReportFormat format,
        ReportStatus status,
        JsonNode summary,
        JsonNode decisionMap,
        List<ReportFindingResponse> findings,
        List<ReportNudgeResponse> nudges,
        String errorCode,
        String errorMessage,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
