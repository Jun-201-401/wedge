package com.wedge.run.api.dto;

import com.wedge.run.domain.StepStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

public record RunStepResponse(
        UUID id,
        UUID runId,
        int stepOrder,
        String stepKey,
        String stepName,
        String stepType,
        StepStatus status,
        OffsetDateTime startedAt,
        OffsetDateTime finishedAt,
        String errorCode,
        String errorMessage
) {
}
