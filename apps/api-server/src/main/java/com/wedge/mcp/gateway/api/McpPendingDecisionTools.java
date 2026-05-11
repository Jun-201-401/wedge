package com.wedge.mcp.gateway.api;

import com.wedge.mcp.gateway.api.dto.ResolveMcpPendingDecisionResponse;
import com.wedge.mcp.gateway.application.McpPendingDecisionResolutionService;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.annotation.McpTool;
import org.springaicommunity.mcp.context.McpSyncRequestContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "spring.ai.mcp.server.enabled", havingValue = "true")
public class McpPendingDecisionTools {
    private final McpPendingDecisionResolutionService resolutionService;

    @McpTool(
            name = "resolve_mcp_pending_decision",
            description = "Resolve the next pending Wedge Runner decision for the current MCP host session using MCP sampling.",
            annotations = @McpTool.McpAnnotations(
                    title = "Resolve MCP Pending Decision",
                    readOnlyHint = false,
                    destructiveHint = false,
                    idempotentHint = false,
                    openWorldHint = false
            )
    )
    public ResolveMcpPendingDecisionResponse resolvePendingDecision(McpSyncRequestContext context) {
        return resolutionService.resolveNext(context);
    }
}
