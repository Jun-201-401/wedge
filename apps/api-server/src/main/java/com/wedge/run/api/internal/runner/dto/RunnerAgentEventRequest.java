package com.wedge.run.api.internal.runner.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record RunnerAgentEventRequest(
        @JsonProperty("schema_version") @NotBlank String schemaVersion,
        @JsonProperty("event_id") @NotBlank String eventId,
        @JsonProperty("task_id") @NotNull UUID taskId,
        @JsonProperty("attempt_id") @NotNull UUID attemptId,
        @JsonProperty("run_id") @NotNull UUID runId,
        @JsonProperty("step_index") @Min(0) int stepIndex,
        @JsonProperty("event_type") @NotBlank String eventType,
        @JsonProperty("occurred_at") @NotNull OffsetDateTime occurredAt,
        @NotNull Map<String, Object> payload
) {
}
