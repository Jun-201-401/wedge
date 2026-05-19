package com.wedge.report.application;

import java.util.List;

record ReportPdfRenderPayload(
        ReportDownloadDocument document,
        List<ReportPdfCandidateImage> candidateImages
) {
}

record ReportPdfCandidateImage(
        int candidateOrder,
        ReportPdfProblemImage image
) {
}

record ReportPdfProblemImage(
        String title,
        String mimeType,
        String dataUri,
        int width,
        int height,
        ReportPdfCrop crop,
        ReportPdfMarker marker
) {
}

record ReportPdfCrop(
        int x,
        int y,
        int width,
        int height
) {
}

record ReportPdfMarker(
        double x,
        double y,
        double width,
        double height
) {
}
