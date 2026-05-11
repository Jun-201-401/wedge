package com.wedge.mcp.gateway.infrastructure;

import com.wedge.mcp.gateway.application.McpDecisionSession;
import com.wedge.mcp.gateway.application.McpDecisionSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class InMemoryMcpDecisionSessionRegistry implements McpDecisionSessionRegistry {
    private final ConcurrentMap<UUID, McpDecisionSession> sessionsByRunId = new ConcurrentHashMap<>();
    private final Duration ttl;
    private final Clock clock;

    public InMemoryMcpDecisionSessionRegistry(
            @Value("${wedge.mcp.decision-session-ttl:PT10M}") Duration ttl,
            Clock clock
    ) {
        this.ttl = ttl;
        this.clock = clock;
    }

    @Override
    public McpDecisionSession register(UUID runId, String sessionId, String clientName, boolean samplingSupported) {
        Instant now = clock.instant();
        McpDecisionSession session = new McpDecisionSession(
                runId,
                sessionId,
                clientName,
                samplingSupported,
                now,
                now.plus(ttl)
        );
        sessionsByRunId.put(runId, session);
        return session;
    }

    @Override
    public Optional<McpDecisionSession> findByRunId(UUID runId) {
        McpDecisionSession session = sessionsByRunId.get(runId);
        if (session == null) {
            return Optional.empty();
        }

        if (session.expired(clock.instant())) {
            sessionsByRunId.remove(runId, session);
            return Optional.empty();
        }

        return Optional.of(session);
    }

    @Override
    public void unregister(UUID runId, String sessionId) {
        sessionsByRunId.computeIfPresent(runId, (ignored, session) ->
                session.sessionId().equals(sessionId) ? null : session
        );
    }
}
