package com.wedge.mcp.gateway.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.mcp.gateway.api.dto.ResolveMcpPendingDecisionResponse;
import com.wedge.mcp.gateway.application.McpPendingDecisionResolutionService;
import org.junit.jupiter.api.Test;
import org.springaicommunity.mcp.context.McpSyncRequestContext;

class McpPendingDecisionToolsTest {
    private final McpPendingDecisionResolutionService service = org.mockito.Mockito.mock(McpPendingDecisionResolutionService.class);
    private final McpPendingDecisionTools tools = new McpPendingDecisionTools(service);

    @Test
    void resolvePendingDecisionDelegatesToResolutionServiceWithCurrentContext() {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        when(service.resolveNext(context)).thenReturn(ResolveMcpPendingDecisionResponse.none("No pending MCP decision is available for this session."));

        ResolveMcpPendingDecisionResponse response = tools.resolvePendingDecision(context);

        assertThat(response.resolved()).isFalse();
        verify(service).resolveNext(context);
    }
}
