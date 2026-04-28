package com.wedge.run.api.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record RunnerCheckpointsRequest(@NotNull @Size(min = 1) List<@Valid RunnerCheckpointRequest> checkpoints) {
}
