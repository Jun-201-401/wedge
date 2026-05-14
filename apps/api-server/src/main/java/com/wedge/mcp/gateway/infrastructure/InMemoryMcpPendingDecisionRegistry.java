package com.wedge.mcp.gateway.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.application.McpDecisionSession;
import com.wedge.mcp.gateway.application.McpPendingDecision;
import com.wedge.mcp.gateway.application.McpPendingDecisionRegistry;
import com.wedge.mcp.gateway.application.McpPendingDecisionStatus;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class InMemoryMcpPendingDecisionRegistry implements McpPendingDecisionRegistry {
    private final ConcurrentMap<UUID, McpPendingDecision> decisionsById = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, Long> creationOrderById = new ConcurrentHashMap<>();
    private final AtomicLong nextCreationOrder = new AtomicLong();
    private final Duration ttl;
    private final Clock clock;

    @Autowired
    public InMemoryMcpPendingDecisionRegistry(
            @Value("${wedge.mcp.pending-decision-ttl:PT2M}") Duration ttl
    ) {
        this(ttl, Clock.systemUTC());
    }

    InMemoryMcpPendingDecisionRegistry(Duration ttl, Clock clock) {
        this.ttl = ttl;
        this.clock = clock;
    }

    @Override
    public McpPendingDecision create(McpDecisionGatewayCommand command, McpDecisionSession session) {
        Instant now = clock.instant();
        McpPendingDecision decision = new McpPendingDecision(
                UUID.randomUUID(),
                command.runId(),
                session.sessionId(),
                session.clientName(),
                command,
                McpPendingDecisionStatus.PENDING,
                now,
                now.plus(ttl),
                null
        );
        decisionsById.put(decision.id(), decision);
        creationOrderById.put(decision.id(), nextCreationOrder.getAndIncrement());
        return decision;
    }

    @Override
    public Optional<McpPendingDecision> findById(UUID id) {
        McpPendingDecision decision = decisionsById.get(id);
        if (decision == null) {
            return Optional.empty();
        }
        return Optional.of(refreshExpiry(decision));
    }

    @Override
    public Optional<McpPendingDecision> findNextPendingForSession(String sessionId) {
        Instant now = clock.instant();
        return decisionsById.values().stream()
                .map(this::refreshExpiry)
                .filter(decision -> decision.status() == McpPendingDecisionStatus.PENDING)
                .filter(decision -> sessionId.equals(decision.sessionId()))
                .filter(decision -> !decision.expiredAt(now))
                .min(Comparator.comparing(McpPendingDecision::createdAt)
                        .thenComparingLong(decision -> creationOrderById.getOrDefault(decision.id(), Long.MAX_VALUE)));
    }

    @Override
    public McpPendingDecision complete(UUID id, Map<String, Object> decisionPayload) {
        return decisionsById.compute(id, (ignored, current) -> {
            if (current == null) {
                throw new BusinessException(
                        ErrorCode.MCP_PENDING_DECISION_NOT_FOUND,
                        "MCP pending decision was not found."
                );
            }
            McpPendingDecision refreshed = refreshExpiry(current);
            if (refreshed.status() == McpPendingDecisionStatus.EXPIRED) {
                return refreshed;
            }
            return new McpPendingDecision(
                    refreshed.id(),
                    refreshed.runId(),
                    refreshed.sessionId(),
                    refreshed.clientName(),
                    refreshed.command(),
                    McpPendingDecisionStatus.COMPLETED,
                    refreshed.createdAt(),
                    refreshed.expiresAt(),
                    Collections.unmodifiableMap(new LinkedHashMap<>(decisionPayload))
            );
        });
    }

    private McpPendingDecision refreshExpiry(McpPendingDecision decision) {
        if (decision.status() != McpPendingDecisionStatus.PENDING || !decision.expiredAt(clock.instant())) {
            return decision;
        }
        McpPendingDecision expired = new McpPendingDecision(
                decision.id(),
                decision.runId(),
                decision.sessionId(),
                decision.clientName(),
                decision.command(),
                McpPendingDecisionStatus.EXPIRED,
                decision.createdAt(),
                decision.expiresAt(),
                decision.decision()
        );
        decisionsById.put(expired.id(), expired);
        return expired;
    }
}
