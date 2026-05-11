package com.wedge.mcp.spike;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.mcp.spike.dto.SamplingDecisionSpikeResponse;
import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springaicommunity.mcp.context.McpSyncRequestContext;

class McpSamplingDecisionSpikeServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final McpSamplingDecisionSpikeService service = new McpSamplingDecisionSpikeService(objectMapper);

    @Test
    void runReturnsUnsupportedWhenSamplingCapabilityIsMissing() {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        when(context.sessionId()).thenReturn("session-1");
        when(context.clientInfo()).thenReturn(new McpSchema.Implementation("fixture-client", "0.1.0"));
        when(context.sampleEnabled()).thenReturn(false);

        SamplingDecisionSpikeResponse response = service.run(context);

        assertThat(response.success()).isFalse();
        assertThat(response.samplingSupported()).isFalse();
        assertThat(response.sessionId()).isEqualTo("session-1");
        assertThat(response.clientName()).isEqualTo("fixture-client");
        assertThat(response.errorCode()).isEqualTo("MCP_SAMPLING_UNSUPPORTED");
        verify(context).sessionId();
        verify(context).clientInfo();
        verify(context).sampleEnabled();
        verifyNoMoreInteractions(context);
    }

    @Test
    void runRejectsInvalidJsonSamplingResult() {
        McpSyncRequestContext context = samplingContextWithText("not-json");

        SamplingDecisionSpikeResponse response = service.run(context);

        assertThat(response.success()).isFalse();
        assertThat(response.samplingSupported()).isTrue();
        assertThat(response.errorCode()).isEqualTo("MCP_SAMPLING_INVALID_JSON");
        assertThat(response.validation().jsonParsed()).isFalse();
    }

    @Test
    void runRejectsDecisionWithCandidateOutsideAllowList() {
        McpSyncRequestContext context = samplingContextWithText("""
                {
                  "decisionType": "ACT",
                  "tool": "click",
                  "candidateId": "candidate_999",
                  "reason": "Wrong candidate.",
                  "confidence": 0.8
                }
                """);

        SamplingDecisionSpikeResponse response = service.run(context);

        assertThat(response.success()).isFalse();
        assertThat(response.errorCode()).isEqualTo("MCP_SAMPLING_INVALID_DECISION");
        assertThat(response.errorMessage()).isEqualTo("candidateId must be one of the fixture candidates.");
    }

    @Test
    void runReturnsSuccessForValidAgentDecisionJson() {
        McpSyncRequestContext context = samplingContextWithText("""
                {
                  "decisionType": "ACT",
                  "tool": "click",
                  "candidateId": "candidate_1",
                  "reason": "The fixture primary CTA is visible.",
                  "confidence": 0.82
                }
                """);

        SamplingDecisionSpikeResponse response = service.run(context);

        assertThat(response.success()).isTrue();
        assertThat(response.samplingSupported()).isTrue();
        assertThat(response.model()).isEqualTo("fixture-sampling-client");
        assertThat(response.stopReason()).isEqualTo("END_TURN");
        assertThat(response.decision().candidateId()).isEqualTo("candidate_1");
        assertThat(response.validation().jsonParsed()).isTrue();
        assertThat(response.validation().schemaValid()).isTrue();
        assertThat(response.validation().candidateAllowed()).isTrue();
        assertThat(response.validation().safetyValid()).isTrue();

        ArgumentCaptor<McpSchema.CreateMessageRequest> requestCaptor =
                ArgumentCaptor.forClass(McpSchema.CreateMessageRequest.class);
        verify(context).sample(requestCaptor.capture());
        McpSchema.CreateMessageRequest request = requestCaptor.getValue();
        assertThat(request.includeContext()).isEqualTo(McpSchema.CreateMessageRequest.ContextInclusionStrategy.NONE);
        assertThat(request.maxTokens()).isEqualTo(500);
        assertThat(request.messages()).hasSize(1);
        assertThat(request.messages().get(0).content())
                .isInstanceOf(McpSchema.TextContent.class)
                .extracting(content -> ((McpSchema.TextContent) content).text())
                .asString()
                .contains("Return only AgentDecision JSON", "candidate_1", "candidate_2");
    }

    @Test
    void runRejectsDecisionContainingForbiddenExecutionText() {
        McpSyncRequestContext context = samplingContextWithText("""
                {
                  "decisionType": "ACT",
                  "tool": "click",
                  "candidateId": "candidate_1",
                  "reason": "Run document.querySelector before clicking.",
                  "confidence": 0.82
                }
                """);

        SamplingDecisionSpikeResponse response = service.run(context);

        assertThat(response.success()).isFalse();
        assertThat(response.errorCode()).isEqualTo("MCP_SAMPLING_INVALID_DECISION");
        assertThat(response.errorMessage()).isEqualTo("AgentDecision contains forbidden raw execution or secret-like text.");
    }

    private McpSyncRequestContext samplingContextWithText(String text) {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        when(context.sessionId()).thenReturn("session-1");
        when(context.clientInfo()).thenReturn(new McpSchema.Implementation("fixture-client", "0.1.0"));
        when(context.sampleEnabled()).thenReturn(true);
        when(context.sample(any(McpSchema.CreateMessageRequest.class))).thenReturn(
                McpSchema.CreateMessageResult.builder()
                        .role(McpSchema.Role.ASSISTANT)
                        .content(new McpSchema.TextContent(text))
                        .model("fixture-sampling-client")
                        .stopReason(McpSchema.CreateMessageResult.StopReason.END_TURN)
                        .build()
        );
        return context;
    }
}
