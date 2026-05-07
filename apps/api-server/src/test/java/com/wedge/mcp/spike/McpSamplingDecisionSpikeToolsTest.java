package com.wedge.mcp.spike;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.mcp.spike.dto.SamplingDecisionSpikeResponse;
import org.junit.jupiter.api.Test;
import org.springaicommunity.mcp.context.McpSyncRequestContext;

class McpSamplingDecisionSpikeToolsTest {
    private final McpSamplingDecisionSpikeService service = org.mockito.Mockito.mock(McpSamplingDecisionSpikeService.class);
    private final McpSamplingDecisionSpikeTools tools = new McpSamplingDecisionSpikeTools(service);

    @Test
    void runSamplingDecisionSpikeDelegatesToService() {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        SamplingDecisionSpikeResponse expected = SamplingDecisionSpikeResponse.unsupported(
                "session-1",
                "fixture-client",
                "unsupported"
        );
        when(service.run(context)).thenReturn(expected);

        SamplingDecisionSpikeResponse response = tools.runSamplingDecisionSpike(context);

        assertThat(response).isEqualTo(expected);
        verify(service).run(context);
    }
}
