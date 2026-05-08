package com.wedge.mcp.gateway.api.internal.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.List;

public record McpDecisionGatewayRequest(
        @NotBlank String goal,
        @NotBlank String startUrl,
        @Valid @NotNull AgentStateRequest state,
        @Valid @NotNull PageObservationRequest page,
        @NotEmpty List<@NotBlank String> allowedActions,
        @Valid @NotNull OutputSchemaRequest outputSchema
) {
    public record AgentStateRequest(
            boolean started,
            @PositiveOrZero int scrollCount,
            @NotNull List<@NotBlank String> clickedTargetKeys
    ) {
    }

    public record PageObservationRequest(
            @NotBlank String finalUrl,
            String title,
            @Valid @NotNull List<CandidateRequest> candidates
    ) {
    }

    public record CandidateRequest(
            @NotBlank String targetKey,
            String text,
            String role,
            @NotBlank String tag,
            boolean isPrimaryLike,
            boolean isCtaCandidate
    ) {
    }

    public record OutputSchemaRequest(
            @NotBlank String kind,
            @NotBlank String actionType,
            @NotBlank String targetKey,
            @NotBlank String scrollY,
            @NotBlank String stage,
            @NotBlank String reason,
            @NotBlank String confidence
    ) {
    }
}
