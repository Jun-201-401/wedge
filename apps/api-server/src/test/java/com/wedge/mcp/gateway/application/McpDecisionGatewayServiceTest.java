package com.wedge.mcp.gateway.application;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class McpDecisionGatewayServiceTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000000901");

    private final McpDecisionSessionRegistry sessionRegistry = org.mockito.Mockito.mock(McpDecisionSessionRegistry.class);
    private final McpDecisionGatewayService service = new McpDecisionGatewayService(sessionRegistry);

    @Test
    void requestDecisionFailsWhenRunHasNoRegisteredMcpSession() {
        when(sessionRegistry.findByRunId(RUN_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.requestDecision(command()))
                .isInstanceOf(BusinessException.class)
                .hasMessage("No active MCP host session is registered for this run.");
    }

    @Test
    void requestDecisionFailsWhenRegisteredSessionDoesNotSupportSampling() {
        when(sessionRegistry.findByRunId(RUN_ID)).thenReturn(Optional.of(session(false)));

        assertThatThrownBy(() -> service.requestDecision(command()))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Registered MCP host session does not support sampling.");
    }

    @Test
    void requestDecisionResolvesRegisteredSamplingSessionBeforeTypedNotImplementedFailure() {
        when(sessionRegistry.findByRunId(RUN_ID)).thenReturn(Optional.of(session(true)));

        assertThatThrownBy(() -> service.requestDecision(command()))
                .isInstanceOf(BusinessException.class)
                .hasMessage("MCP host session is registered, but decision sampling routing is not implemented yet.");
    }

    private McpDecisionSession session(boolean samplingSupported) {
        return new McpDecisionSession(
                RUN_ID,
                "session-1",
                "inspector-client",
                samplingSupported,
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
