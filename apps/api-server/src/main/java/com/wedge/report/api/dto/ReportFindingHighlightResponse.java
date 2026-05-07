package com.wedge.report.api.dto;

import java.math.BigDecimal;

public record ReportFindingHighlightResponse(
        String evidenceRef,
        String label,
        String source,
        String coordinateSpace,
        Bounds bounds,
        Viewport viewport,
        String screenshotArtifactId
) {
    public record Bounds(
            BigDecimal x,
            BigDecimal y,
            BigDecimal width,
            BigDecimal height,
            String unit
    ) {
    }

    public record Viewport(
            BigDecimal width,
            BigDecimal height
    ) {
    }
}
