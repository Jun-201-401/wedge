package com.wedge.mcp.gateway.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.mcp.gateway.api.dto.ResolveMcpPendingDecisionResponse;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import io.modelcontextprotocol.spec.McpSchema;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springaicommunity.mcp.context.McpSyncRequestContext;

class McpPendingDecisionResolutionServiceTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000000901");
    private static final UUID PENDING_ID = UUID.fromString("00000000-0000-4000-8000-000000000902");

    private final McpPendingDecisionRegistry registry = org.mockito.Mockito.mock(McpPendingDecisionRegistry.class);
    private final McpPendingDecisionResolutionService service = new McpPendingDecisionResolutionService(registry, new ObjectMapper());

    @Test
    void resolveNextReturnsNoneWhenSessionHasNoPendingDecision() {
        McpSyncRequestContext context = contextWithSampling("{}");
        when(registry.findNextPendingForSession("session-1")).thenReturn(Optional.empty());

        ResolveMcpPendingDecisionResponse response = service.resolveNext(context);

        assertThat(response.resolved()).isFalse();
        assertThat(response.message()).isEqualTo("No pending MCP decision is available for this session.");
        verify(context, never()).sample(any(McpSchema.CreateMessageRequest.class));
    }

    @Test
    void resolveNextSamplesDecisionInsideCurrentMcpRequestAndCompletesPendingDecision() {
        McpPendingDecision pendingDecision = pendingDecision(null);
        McpPendingDecision completedDecision = pendingDecision(Map.of(
                "kind", "act",
                "actionType", "click",
                "targetKey", "candidate_001",
                "stage", "CTA",
                "reason", "Checkout CTA is visible.",
                "confidence", 0.84
        ));
        McpSyncRequestContext context = contextWithSampling("""
                {
                  "kind": "act",
                  "actionType": "click",
                  "targetKey": "candidate_001",
                  "stage": "CTA",
                  "reason": "Checkout CTA is visible.",
                  "confidence": 0.84
                }
                """);
        when(registry.findNextPendingForSession("session-1")).thenReturn(Optional.of(pendingDecision));
        when(registry.complete(any(), any())).thenReturn(completedDecision);

        ResolveMcpPendingDecisionResponse response = service.resolveNext(context);

        assertThat(response.resolved()).isTrue();
        assertThat(response.pendingDecisionId()).isEqualTo(PENDING_ID);
        assertThat(response.runId()).isEqualTo(RUN_ID);
        assertThat(response.model()).isEqualTo("fixture-sampling-client");
        assertThat(response.decision()).containsEntry("targetKey", "candidate_001");

        ArgumentCaptor<McpSchema.CreateMessageRequest> requestCaptor =
                ArgumentCaptor.forClass(McpSchema.CreateMessageRequest.class);
        verify(context).sample(requestCaptor.capture());
        assertThat(requestCaptor.getValue().includeContext())
                .isEqualTo(McpSchema.CreateMessageRequest.ContextInclusionStrategy.NONE);
        assertThat(requestCaptor.getValue().messages().get(0).content())
                .isInstanceOf(McpSchema.TextContent.class)
                .extracting(content -> ((McpSchema.TextContent) content).text())
                .asString()
                .contains("Return only AgentDecision JSON", "candidate_001");
        verify(registry).complete(PENDING_ID, response.decision());
    }

    @Test
    void resolveNextRejectsClickTargetOutsideObservedCandidates() {
        McpSyncRequestContext context = contextWithSampling("""
                {
                  "kind": "act",
                  "actionType": "click",
                  "targetKey": "candidate_999",
                  "stage": "CTA",
                  "reason": "Wrong candidate.",
                  "confidence": 0.84
                }
                """);
        when(registry.findNextPendingForSession("session-1")).thenReturn(Optional.of(pendingDecision(null)));

        assertThatThrownBy(() -> service.resolveNext(context))
                .isInstanceOf(BusinessException.class)
                .hasMessage("click targetKey must match an observed candidate.");
        verify(registry, never()).complete(any(), any());
    }

    private McpSyncRequestContext contextWithSampling(String samplingText) {
        McpSyncRequestContext context = org.mockito.Mockito.mock(McpSyncRequestContext.class);
        when(context.sessionId()).thenReturn("session-1");
        when(context.sampleEnabled()).thenReturn(true);
        when(context.sample(any(McpSchema.CreateMessageRequest.class))).thenReturn(
                McpSchema.CreateMessageResult.builder()
                        .role(McpSchema.Role.ASSISTANT)
                        .content(new McpSchema.TextContent(samplingText))
                        .model("fixture-sampling-client")
                        .stopReason(McpSchema.CreateMessageResult.StopReason.END_TURN)
                        .build()
        );
        return context;
    }

    private McpPendingDecision pendingDecision(Map<String, Object> decision) {
        McpPendingDecisionStatus status = decision == null
                ? McpPendingDecisionStatus.PENDING
                : McpPendingDecisionStatus.COMPLETED;
        return new McpPendingDecision(
                PENDING_ID,
                RUN_ID,
                "session-1",
                "inspector-client",
                command(),
                status,
                Instant.parse("2026-05-11T01:00:00Z"),
                Instant.parse("2026-05-11T01:02:00Z"),
                decision
        );
    }

    private McpDecisionGatewayCommand command() {
        return new McpDecisionGatewayCommand(
                RUN_ID,
                "Find checkout",
                "https://example.com/product",
                new McpDecisionGatewayCommand.AgentState(true, 0, List.of()),
                new McpDecisionGatewayCommand.PageObservation(
                        "https://example.com/product",
                        "Product",
                        List.of(new McpDecisionGatewayCommand.Candidate(
                                "candidate_001",
                                "Checkout",
                                "link",
                                "a",
                                true,
                                true
                        ))
                ),
                List.of("click", "scroll", "checkpoint", "finish"),
                new McpDecisionGatewayCommand.OutputSchema(
                        "act|checkpoint|finish",
                        "goto|click|scroll|checkpoint",
                        "opaque candidate targetKey for click, null otherwise",
                        "number, only for scroll",
                        "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
                        "short reason",
                        "0..1"
                )
        );
    }
}
