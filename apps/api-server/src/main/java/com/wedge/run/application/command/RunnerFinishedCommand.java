package com.wedge.run.application.command;

import java.time.OffsetDateTime;

public record RunnerFinishedCommand(
        String workerId,
        OffsetDateTime executionFinishedAt,
        int completedStepCount,
        int failedStepCount,
        boolean stopped
) {
}
