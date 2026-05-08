package com.wedge.mcp.gateway.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpDecisionGatewayService {
    private final McpDecisionSessionRegistry sessionRegistry;

    public void requestDecision(McpDecisionGatewayCommand command) {
        McpDecisionSession session = sessionRegistry.findByRunId(command.runId())
                .orElseThrow(() -> new BusinessException(
                        ErrorCode.MCP_SESSION_UNAVAILABLE,
                        "No active MCP host session is registered for this run."
                ));

        if (!session.samplingSupported()) {
            throw new BusinessException(
                    ErrorCode.MCP_SESSION_UNAVAILABLE,
                    "Registered MCP host session does not support sampling."
            );
        }

        throw new BusinessException(
                ErrorCode.MCP_SESSION_UNAVAILABLE,
                "MCP host session is registered, but decision sampling routing is not implemented yet."
        );
    }
}
