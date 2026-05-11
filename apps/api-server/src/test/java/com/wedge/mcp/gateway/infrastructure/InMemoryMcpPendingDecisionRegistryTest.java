package com.wedge.mcp.gateway.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.wedge.mcp.gateway.application.McpDecisionSession;
import com.wedge.mcp.gateway.application.McpPendingDecision;
import com.wedge.mcp.gateway.application.McpPendingDecisionStatus;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class InMemoryMcpPendingDecisionRegistryTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000000801");
    private final Clock clock = Clock.fixed(Instant.parse("2026-05-11T01:00:00Z"), ZoneOffset.UTC);
    private final InMemoryMcpPendingDecisionRegistry registry = new InMemoryMcpPendingDecisionRegistry(Duration.ofMinutes(2), clock);

    @Test
    void createStoresPendingDecisionForRegisteredSession() {
        McpPendingDecision pendingDecision = registry.create(command(), session());

        assertThat(pendingDecision.runId()).isEqualTo(RUN_ID);
        assertThat(pendingDecision.sessionId()).isEqualTo("session-1");
        assertThat(pendingDecision.status()).isEqualTo(McpPendingDecisionStatus.PENDING);
        assertThat(pendingDecision.expiresAt()).isEqualTo(Instant.parse("2026-05-11T01:02:00Z"));
        assertThat(registry.findById(pendingDecision.id())).contains(pendingDecision);
    }

    @Test
    void findNextPendingForSessionReturnsOldestPendingDecision() {
        McpPendingDecision first = registry.create(command(), session());
        registry.create(command(UUID.fromString("00000000-0000-4000-8000-000000000802")), session());

        assertThat(registry.findNextPendingForSession("session-1")).contains(first);
    }

    @Test
    void completeStoresDecisionPayloadWithNullableTargetKey() {
        McpPendingDecision pendingDecision = registry.create(command(), session());
        Map<String, Object> decision = new LinkedHashMap<>();
        decision.put("kind", "checkpoint");
        decision.put("actionType", "checkpoint");
        decision.put("targetKey", null);
        decision.put("reason", "Stop safely.");
        decision.put("confidence", 0.7);

        McpPendingDecision completed = registry.complete(pendingDecision.id(), decision);

        assertThat(completed.status()).isEqualTo(McpPendingDecisionStatus.COMPLETED);
        assertThat(completed.decision()).containsEntry("kind", "checkpoint");
        assertThat(completed.decision()).containsEntry("targetKey", null);
        assertThat(registry.findNextPendingForSession("session-1")).isEmpty();
    }

    private McpDecisionSession session() {
        return new McpDecisionSession(
                RUN_ID,
                "session-1",
                "inspector-client",
                true,
                Instant.parse("2026-05-11T01:00:00Z"),
                Instant.parse("2026-05-11T01:10:00Z")
        );
    }

    private McpDecisionGatewayCommand command() {
        return command(RUN_ID);
    }

    private McpDecisionGatewayCommand command(UUID runId) {
        return new McpDecisionGatewayCommand(
                runId,
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
