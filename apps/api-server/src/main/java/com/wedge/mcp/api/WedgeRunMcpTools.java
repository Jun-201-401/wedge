package com.wedge.mcp.api;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.api.dto.GetRunStatusResponse;
import com.wedge.mcp.application.McpRunQueryService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.annotation.McpTool;
import org.springaicommunity.mcp.annotation.McpToolParam;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "spring.ai.mcp.server.enabled", havingValue = "true")
public class WedgeRunMcpTools {
    private final McpRunQueryService mcpRunQueryService;

    @McpTool(
            name = "get_run_status",
            description = "Read the current status and lightweight execution metadata for a Wedge run.",
            annotations = @McpTool.McpAnnotations(
                    title = "Get Run Status",
                    readOnlyHint = true,
                    destructiveHint = false,
                    idempotentHint = true
            )
    )
    public GetRunStatusResponse getRunStatus(
            @McpToolParam(description = "Wedge run ID in UUID format.", required = true) String runId
    ) {
        return mcpRunQueryService.getRunStatus(parseRunId(runId));
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
