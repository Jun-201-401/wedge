package com.wedge.report.api.dto;

import java.util.UUID;

public record ReportDetailNudgeResponse(
        UUID id,
        Integer rank,
        String title,
        String rationale,
        String recommendation,
        String difficulty,
        String expectedEffect,
        String validationQuestion
) {
}
