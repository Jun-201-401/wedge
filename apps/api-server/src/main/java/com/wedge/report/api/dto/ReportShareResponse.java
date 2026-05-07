package com.wedge.report.api.dto;

import com.wedge.report.domain.ReportShare;
import java.time.OffsetDateTime;
import java.util.UUID;

public record ReportShareResponse(
        UUID id,
        UUID reportId,
        String shareUrl,
        String accessLevel,
        OffsetDateTime expiresAt,
        OffsetDateTime revokedAt,
        OffsetDateTime createdAt
) {
    public static ReportShareResponse from(ReportShare share, String shareUrl) {
        return new ReportShareResponse(
                share.getId(),
                share.getReportId(),
                shareUrl,
                share.getAccessLevel(),
                share.getExpiresAt(),
                share.getRevokedAt(),
                share.getCreatedAt()
        );
    }
}
