package com.wedge.internal.runner.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record RunnerArtifactsRequest(@NotNull @Size(min = 1) List<@Valid RunnerArtifactRequest> artifacts) {
}
