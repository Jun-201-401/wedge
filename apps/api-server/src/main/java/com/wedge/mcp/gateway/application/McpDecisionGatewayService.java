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
    private final McpSamplingBridge samplingBridge;

    public McpDecisionGatewayResponse requestDecision(McpDecisionGatewayCommand command) {
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

        return samplingBridge.requestDecision(command, session);
    }
}
