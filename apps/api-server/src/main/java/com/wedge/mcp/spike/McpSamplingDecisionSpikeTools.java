package com.wedge.mcp.spike;

import com.wedge.mcp.spike.dto.SamplingDecisionSpikeResponse;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.annotation.McpTool;
import org.springaicommunity.mcp.context.McpSyncRequestContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "spring.ai.mcp.server.enabled", havingValue = "true")
public class McpSamplingDecisionSpikeTools {
    private final McpSamplingDecisionSpikeService service;

    @McpTool(
            name = "mcp_sampling_decision_spike",
            description = "Internal spike tool that verifies MCP client sampling can return an AgentDecision JSON for a fixture observation.",
            annotations = @McpTool.McpAnnotations(
                    title = "MCP Sampling Decision Spike",
                    readOnlyHint = true,
                    destructiveHint = false,
                    idempotentHint = false
            )
    )
    public SamplingDecisionSpikeResponse runSamplingDecisionSpike(McpSyncRequestContext context) {
        return service.run(context);
    }
}
