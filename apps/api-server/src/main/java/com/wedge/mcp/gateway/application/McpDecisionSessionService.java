package com.wedge.mcp.gateway.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import io.modelcontextprotocol.spec.McpSchema;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.context.McpSyncRequestContext;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpDecisionSessionService {
    private final McpDecisionSessionRegistry registry;

    public McpDecisionSession register(UUID runId, McpSyncRequestContext context) {
        if (context == null || isBlank(context.sessionId())) {
            throw new BusinessException(
                    ErrorCode.MCP_SESSION_UNAVAILABLE,
                    "MCP decision session registration requires a stateful MCP host session."
            );
        }

        return registry.register(
                runId,
                context.sessionId(),
                clientName(context),
                context.sampleEnabled()
        );
    }

    private String clientName(McpSyncRequestContext context) {
        McpSchema.Implementation clientInfo = context.clientInfo();
        return clientInfo == null ? null : clientInfo.name();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
