package com.wedge.report.api.dto;

import com.wedge.analysis.domain.Nudge;
import java.util.UUID;

public record ReportNudgeResponse(
        UUID id,
        UUID findingId,
        Integer rankOrder,
        String title,
        String rationale,
        String recommendation,
        String difficulty,
        String expectedEffect,
        String validationQuestion
) {
    public static ReportNudgeResponse from(Nudge nudge) {
        return new ReportNudgeResponse(
                nudge.getId(),
                nudge.getFindingId(),
                nudge.getRankOrder(),
                nudge.getTitle(),
                nudge.getRationale(),
                nudge.getRecommendation(),
                nudge.getDifficulty(),
                nudge.getExpectedEffect(),
                nudge.getValidationQuestion()
        );
    }
}
