package com.wedge.mcp.gateway.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpPendingDecisionService {
    private final McpDecisionSessionRegistry sessionRegistry;
    private final McpPendingDecisionRegistry pendingDecisionRegistry;

    public McpPendingDecision create(McpDecisionGatewayCommand command) {
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

        return pendingDecisionRegistry.create(command, session);
    }

    public McpPendingDecision get(UUID pendingDecisionId) {
        return pendingDecisionRegistry.findById(pendingDecisionId)
                .orElseThrow(() -> new BusinessException(
                        ErrorCode.MCP_PENDING_DECISION_NOT_FOUND,
                        "MCP pending decision was not found."
                ));
    }
}
