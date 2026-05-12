package com.wedge.mcp.gateway.application;

import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;

public interface McpSamplingBridge {
    McpDecisionGatewayResponse requestDecision(McpDecisionGatewayCommand command, McpDecisionSession session);
}
