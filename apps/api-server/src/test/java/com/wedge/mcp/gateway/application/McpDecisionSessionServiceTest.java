package com.wedge.mcp.gateway.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import io.modelcontextprotocol.spec.McpSchema;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springaicommunity.mcp.context.McpSyncRequestContext;

class McpDecisionSessionServiceTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000000801");

    private final McpDecisionSessionRegistry registry = org.mockito.Mockito.mock(McpDecisionSessionRegistry.class);
    private final McpDecisionSessionService service = new McpDecisionSessionService(registry);

    @Test
    void registerStoresCurrentMcpContextAsRunDecisionSession() {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        when(context.sessionId()).thenReturn("session-1");
        when(context.clientInfo()).thenReturn(new McpSchema.Implementation("inspector-client", "0.21.2"));
        when(context.sampleEnabled()).thenReturn(true);
        McpDecisionSession expected = new McpDecisionSession(
                RUN_ID,
                "session-1",
                "inspector-client",
                true,
                Instant.parse("2026-05-08T07:00:00Z"),
                Instant.parse("2026-05-08T07:10:00Z")
        );
        when(registry.register(RUN_ID, "session-1", "inspector-client", true)).thenReturn(expected);

        McpDecisionSession session = service.register(RUN_ID, context);

        assertThat(session).isEqualTo(expected);
        verify(registry).register(RUN_ID, "session-1", "inspector-client", true);
    }

    @Test
    void registerRejectsMissingStatefulSessionId() {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        when(context.sessionId()).thenReturn("");

        assertThatThrownBy(() -> service.register(RUN_ID, context))
                .isInstanceOf(BusinessException.class)
                .hasMessage("MCP decision session registration requires a stateful MCP host session.");
    }
}
