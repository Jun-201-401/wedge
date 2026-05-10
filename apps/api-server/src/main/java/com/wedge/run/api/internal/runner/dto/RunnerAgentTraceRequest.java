package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record RunnerAgentTraceRequest(@NotNull Map<String, Object> trace) {
}
