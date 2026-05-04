package com.wedge.discovery.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class SiteDiscovery {
    private UUID id;
    private UUID projectId;
    private String inputUrl;
    private String finalUrl;
    private String devicePreset;
    private String viewportJsonb;
    private DiscoveryStatus status;
    private String summaryJsonb;
    private UUID createdBy;
    private String idempotencyKey;
    private OffsetDateTime startedAt;
    private OffsetDateTime finishedAt;
    private String failureCode;
    private String failureMessage;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private OffsetDateTime deletedAt;
    private long version;
}
