package com.wedge.report.api.dto;

import com.wedge.evidence.api.dto.ArtifactResponse;

public record ReportPreviewImageResponse(
        ArtifactResponse artifact,
        String source
) {
}
