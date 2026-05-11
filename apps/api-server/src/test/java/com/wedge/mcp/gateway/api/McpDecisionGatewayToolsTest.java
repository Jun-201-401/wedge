package com.wedge.mcp.gateway.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.mcp.gateway.api.dto.RegisterMcpDecisionSessionResponse;
import com.wedge.mcp.gateway.application.McpDecisionSession;
import com.wedge.mcp.gateway.application.McpDecisionSessionService;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springaicommunity.mcp.context.McpSyncRequestContext;

class McpDecisionGatewayToolsTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000001001");

    private final McpDecisionSessionService sessionService = org.mockito.Mockito.mock(McpDecisionSessionService.class);
    private final McpDecisionGatewayTools tools = new McpDecisionGatewayTools(sessionService);

    @Test
    void registerDecisionSessionDelegatesToSessionService() {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        McpDecisionSession session = new McpDecisionSession(
                RUN_ID,
                "session-1",
                "inspector-client",
                true,
                Instant.parse("2026-05-08T07:00:00Z"),
                Instant.parse("2026-05-08T07:10:00Z")
        );
        when(sessionService.register(RUN_ID, context)).thenReturn(session);

        RegisterMcpDecisionSessionResponse response = tools.registerDecisionSession(RUN_ID.toString(), context);

        assertThat(response.runId()).isEqualTo(RUN_ID);
        assertThat(response.sessionId()).isEqualTo("session-1");
        assertThat(response.clientName()).isEqualTo("inspector-client");
        assertThat(response.samplingSupported()).isTrue();
        assertThat(response.samplingRoutingReady()).isFalse();
        assertThat(response.expiresAt()).isEqualTo(Instant.parse("2026-05-08T07:10:00Z"));
        verify(sessionService).register(RUN_ID, context);
    }
}
