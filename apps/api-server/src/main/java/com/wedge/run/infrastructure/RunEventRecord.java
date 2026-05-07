package com.wedge.run.infrastructure;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class RunEventRecord {
    private UUID id;
    private UUID runId;
    private UUID stepId;
    private String stepKey;
    private String eventType;
    private String source;
    private String payloadJson;
    private OffsetDateTime occurredAt;
}
