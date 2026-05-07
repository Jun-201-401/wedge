package com.wedge.run.application.command;

import com.wedge.run.domain.ResultCompleteness;
import java.time.OffsetDateTime;

public record RunnerFailedCommand(
        String workerId,
        OffsetDateTime failedAt,
        String failureCode,
        String failureMessage,
        ResultCompleteness resultCompleteness,
        Integer completedStepCount,
        Integer failedStepCount,
        Boolean stopped
) {
}
