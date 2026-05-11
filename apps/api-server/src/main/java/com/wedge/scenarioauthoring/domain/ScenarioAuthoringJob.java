package com.wedge.scenarioauthoring.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class ScenarioAuthoringJob {
    private UUID id;
    private UUID projectId;
    private UUID sourceDiscoveryId;
    private String correlationId;
    private String idempotencyKey;
    private ScenarioAuthoringStatus status;
    private String inputJsonb;
    private String providerPolicyJsonb;
    private String providerTraceJsonb;
    private String candidatesJsonb;
    private String validationJsonb;
    private String provenanceJsonb;
    private String failureJsonb;
    private UUID createdBy;
    private String confirmedCandidateId;
    private UUID confirmedBy;
    private OffsetDateTime confirmedAt;
    private UUID materializedRunId;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private OffsetDateTime expiresAt;
    private OffsetDateTime deletedAt;
    private long version;
}
