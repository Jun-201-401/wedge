package com.wedge.run.api.dto;

import com.wedge.run.domain.RunStatus;
import java.util.UUID;

public record RunActionResponse(UUID runId, RunStatus status) {
    public static RunActionResponse from(RunResponse run) {
        return new RunActionResponse(run.id(), run.status());
    }
}
