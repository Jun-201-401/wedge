package com.wedge.mcp.gateway.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.wedge.mcp.gateway.application.McpDecisionSession;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class InMemoryMcpDecisionSessionRegistryTest {
    private static final UUID RUN_ID = UUID.fromString("00000000-0000-4000-8000-000000000701");
    private static final Instant NOW = Instant.parse("2026-05-08T07:00:00Z");

    @Test
    void registerStoresRunScopedSessionLease() {
        InMemoryMcpDecisionSessionRegistry registry = new InMemoryMcpDecisionSessionRegistry(
                Duration.ofMinutes(10),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        McpDecisionSession session = registry.register(RUN_ID, "session-1", "inspector-client", true);

        assertThat(session.runId()).isEqualTo(RUN_ID);
        assertThat(session.sessionId()).isEqualTo("session-1");
        assertThat(session.clientName()).isEqualTo("inspector-client");
        assertThat(session.samplingSupported()).isTrue();
        assertThat(session.registeredAt()).isEqualTo(NOW);
        assertThat(session.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(10)));
        assertThat(registry.findByRunId(RUN_ID)).contains(session);
    }

    @Test
    void findByRunIdEvictsExpiredSession() {
        InMemoryMcpDecisionSessionRegistry registry = new InMemoryMcpDecisionSessionRegistry(
                Duration.ZERO,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
        registry.register(RUN_ID, "session-1", "inspector-client", true);

        assertThat(registry.findByRunId(RUN_ID)).isEmpty();
    }

    @Test
    void unregisterRemovesOnlyMatchingSession() {
        InMemoryMcpDecisionSessionRegistry registry = new InMemoryMcpDecisionSessionRegistry(
                Duration.ofMinutes(10),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
        registry.register(RUN_ID, "session-1", "inspector-client", true);

        registry.unregister(RUN_ID, "different-session");
        assertThat(registry.findByRunId(RUN_ID)).isPresent();

        registry.unregister(RUN_ID, "session-1");
        assertThat(registry.findByRunId(RUN_ID)).isEmpty();
    }
}
