package com.wedge.report.api.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record ReportDetailFindingResponse(
        UUID id,
        int rank,
        String title,
        String summary,
        String category,
        String stage,
        String axis,
        Integer severity,
        BigDecimal confidence,
        BigDecimal priorityScore,
        String impactHypothesis,
        List<Object> evidenceRefs,
        ReportPreviewImageResponse previewImage,
        List<ReportDetailNudgeResponse> nudges
) {
}
