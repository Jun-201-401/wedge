package com.wedge.report.api.dto;

import java.math.BigDecimal;
import java.util.UUID;

public record ReportTopFindingResponse(
        UUID id,
        int rank,
        String title,
        String summary,
        String stage,
        Integer severity,
        BigDecimal confidence,
        BigDecimal priorityScore,
        ReportPreviewImageResponse previewImage
) {
}
