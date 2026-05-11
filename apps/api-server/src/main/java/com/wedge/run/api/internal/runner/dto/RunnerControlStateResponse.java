package com.wedge.run.api.internal.runner.dto;

import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.util.UUID;

public record RunnerControlStateResponse(
        UUID runId,
        RunStatus status,
        boolean stopRequested,
        ResultCompleteness resultCompleteness
) {
}
