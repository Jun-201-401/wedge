package com.wedge.evidence.api.dto;

import java.util.List;

public record ArtifactPresignedUrlsResponse(
        List<ArtifactPresignedUrlItemResponse> urls
) {
}
