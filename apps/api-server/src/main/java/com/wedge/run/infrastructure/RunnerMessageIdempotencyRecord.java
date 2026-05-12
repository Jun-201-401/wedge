package com.wedge.run.infrastructure;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunnerMessageIdempotencyRecord {
    private String scope;
    private String idempotencyKeyHash;
    private UUID runId;
    private String resultJson;
    private OffsetDateTime completedAt;
}
