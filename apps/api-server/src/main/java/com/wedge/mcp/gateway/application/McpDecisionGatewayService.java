package com.wedge.mcp.gateway.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import org.springframework.stereotype.Service;

@Service
public class McpDecisionGatewayService {

    public void requestDecision(McpDecisionGatewayCommand command) {
        throw new BusinessException(
                ErrorCode.MCP_SESSION_UNAVAILABLE,
                "No active MCP host session is available for MCP decision sampling."
        );
    }
}
