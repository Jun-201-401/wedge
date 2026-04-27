package com.wedge.run.infrastructure;

import com.wedge.run.domain.StepStatus;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class RunStepRecord {
    private UUID id;
    private UUID runId;
    private int stepOrder;
    private String stepKey;
    private String stepName;
    private String stage;
    private String stepType;
    private StepStatus status;
    private OffsetDateTime startedAt;
    private OffsetDateTime finishedAt;
    private String errorCode;
    private String errorMessage;
}
