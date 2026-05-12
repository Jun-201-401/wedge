package com.wedge.mcp.gateway.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class UnsupportedMcpSamplingBridgeTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000001101");
    private final UnsupportedMcpSamplingBridge bridge = new UnsupportedMcpSamplingBridge();

    @Test
    void requestDecisionReturnsTypedUnavailableFailure() {
        assertThatThrownBy(() -> bridge.requestDecision(command(), session()))
                .isInstanceOfSatisfying(BusinessException.class, exception -> {
                    assertThat(exception.errorCode()).isEqualTo(ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE);
                    assertThat(exception.getMessage()).isEqualTo("Registered MCP host session cannot be used for deferred sampling yet.");
                });
    }

    private McpDecisionSession session() {
        return new McpDecisionSession(
                RUN_ID,
                "session-1",
                "inspector-client",
                true,
                Instant.parse("2026-05-08T07:00:00Z"),
                Instant.parse("2026-05-08T07:10:00Z")
        );
    }

    private McpDecisionGatewayCommand command() {
        return new McpDecisionGatewayCommand(
                RUN_ID,
                "Find checkout",
                "https://example.com",
                new McpDecisionGatewayCommand.AgentState(true, 0, List.of()),
                new McpDecisionGatewayCommand.PageObservation("https://example.com", "Example", List.of()),
                List.of("click", "scroll", "checkpoint", "finish"),
                new McpDecisionGatewayCommand.OutputSchema(
                        "act|checkpoint|finish",
                        "goto|click|scroll|checkpoint",
                        "opaque candidate targetKey for click, null otherwise",
                        "number, only for scroll",
                        "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
                        "short reason",
                        "0..1"
                )
        );
    }
}
