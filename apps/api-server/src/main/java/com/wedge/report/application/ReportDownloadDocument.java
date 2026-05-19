package com.wedge.report.application;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

record ReportDownloadDocument(
        UUID reportId,
        UUID runId,
        String targetUrl,
        String goal,
        String createdAt,
        int totalSteps,
        int findingCount,
        String durationLabel,
        List<ReportDownloadCandidate> candidates,
        List<ReportDownloadFlowGuide> flowGuides
) {
}

record ReportDownloadCandidate(
        int order,
        String title,
        String stage,
        ReportDownloadProblemLocation location,
        String problemSummary,
        String improvementDirection,
        String judgementBasis,
        String expectedEffect,
        String difficulty,
        String validationQuestion,
        List<ReportDownloadReference> references
) {
}

record ReportDownloadProblemLocation(
        String label,
        String selector,
        String role,
        String evidenceRef,
        String screenshotArtifactId,
        String coordinateSpace,
        String bounds,
        String viewport,
        String scrollY,
        ReportDownloadLocationGeometry geometry
) {
}

record ReportDownloadLocationGeometry(
        String unit,
        java.math.BigDecimal x,
        java.math.BigDecimal y,
        java.math.BigDecimal width,
        java.math.BigDecimal height,
        java.math.BigDecimal viewportWidth,
        java.math.BigDecimal viewportHeight,
        java.math.BigDecimal scrollY
) {
}

record ReportDownloadReference(
        String publisher,
        String title,
        String basisSummary,
        String url
) {
}

record ReportDownloadFlowGuide(
        String label,
        String description,
        ReportDownloadReference reference
) {
}
