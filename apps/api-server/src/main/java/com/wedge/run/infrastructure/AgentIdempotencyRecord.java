package com.wedge.run.infrastructure;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class AgentIdempotencyRecord {
    private String idempotencyKeyHash;
    private UUID runId;
    private String taskId;
    private String attemptId;
    private Integer attemptIndex;
    private String resultJson;
    private String outcomeStatus;
    private OffsetDateTime completedAt;
}
