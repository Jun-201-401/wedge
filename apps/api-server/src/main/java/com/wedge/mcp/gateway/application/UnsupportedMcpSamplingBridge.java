package com.wedge.mcp.gateway.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import org.springframework.stereotype.Component;

@Component
public class UnsupportedMcpSamplingBridge implements McpSamplingBridge {
    @Override
    public McpDecisionGatewayResponse requestDecision(McpDecisionGatewayCommand command, McpDecisionSession session) {
        throw new BusinessException(
                ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE,
                "Registered MCP host session cannot be used for deferred sampling yet."
        );
    }
}
