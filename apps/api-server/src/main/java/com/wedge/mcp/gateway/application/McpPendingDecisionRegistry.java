package com.wedge.mcp.gateway.application;

import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface McpPendingDecisionRegistry {
    McpPendingDecision create(McpDecisionGatewayCommand command, McpDecisionSession session);

    Optional<McpPendingDecision> findById(UUID id);

    Optional<McpPendingDecision> findNextPendingForSession(String sessionId);

    McpPendingDecision complete(UUID id, Map<String, Object> decision);
}
