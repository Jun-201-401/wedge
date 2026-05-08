package com.wedge.mcp.gateway.application;

import java.util.Map;

public record McpDecisionGatewayResponse(
        Map<String, Object> decision
) {
}
