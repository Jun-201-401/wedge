package com.wedge.report.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class ReportShare {
    private UUID id;
    private UUID reportId;
    private String shareToken;
    private String accessLevel;
    private OffsetDateTime expiresAt;
    private OffsetDateTime revokedAt;
    private UUID createdBy;
    private OffsetDateTime createdAt;
}
