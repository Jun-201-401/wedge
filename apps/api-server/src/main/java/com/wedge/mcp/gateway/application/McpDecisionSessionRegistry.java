package com.wedge.mcp.gateway.application;

import java.util.Optional;
import java.util.UUID;

public interface McpDecisionSessionRegistry {
    McpDecisionSession register(UUID runId, String sessionId, String clientName, boolean samplingSupported);

    Optional<McpDecisionSession> findByRunId(UUID runId);

    void unregister(UUID runId, String sessionId);
}
