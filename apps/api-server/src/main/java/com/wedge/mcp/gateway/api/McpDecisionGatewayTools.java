package com.wedge.mcp.gateway.api;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.api.dto.RegisterMcpDecisionSessionResponse;
import com.wedge.mcp.gateway.application.McpDecisionSession;
import com.wedge.mcp.gateway.application.McpDecisionSessionService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.annotation.McpTool;
import org.springaicommunity.mcp.annotation.McpToolParam;
import org.springaicommunity.mcp.context.McpSyncRequestContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "spring.ai.mcp.server.enabled", havingValue = "true")
public class McpDecisionGatewayTools {
    private final McpDecisionSessionService sessionService;

    @McpTool(
            name = "register_mcp_decision_session",
            description = "Register the current MCP host session as the decision session for a Wedge run.",
            annotations = @McpTool.McpAnnotations(
                    title = "Register MCP Decision Session",
                    readOnlyHint = false,
                    destructiveHint = false,
                    idempotentHint = true
            )
    )
    public RegisterMcpDecisionSessionResponse registerDecisionSession(
            @McpToolParam(description = "Wedge run ID in UUID format.", required = true) String runId,
            McpSyncRequestContext context
    ) {
        McpDecisionSession session = sessionService.register(parseRunId(runId), context);
        return RegisterMcpDecisionSessionResponse.fromSession(session);
    }

    private UUID parseRunId(String runId) {
        if (runId == null || runId.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "runId is required.");
        }

        try {
            return UUID.fromString(runId);
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "runId must be a valid UUID.", null, exception);
        }
    }
}
