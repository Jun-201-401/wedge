package com.wedge.run.infrastructure;

import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class OutboxMessageRecord {
    private UUID id;
    private String aggregateType;
    private UUID aggregateId;
    private String eventType;
    private String payloadJson;

}
