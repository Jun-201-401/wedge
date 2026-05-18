package com.wedge.discovery.infrastructure;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.discovery.application.DiscoveryService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class DiscoveryExecutionDeadLetterListener {
    private static final Logger log = LoggerFactory.getLogger(DiscoveryExecutionDeadLetterListener.class);
    private static final String FAILURE_CODE = "DISCOVERY_REQUEST_DEAD_LETTERED";
    private static final String FAILURE_MESSAGE = "Discovery request could not be delivered to Runner.";

    private final ObjectMapper objectMapper;
    private final DiscoveryService discoveryService;

    public DiscoveryExecutionDeadLetterListener(ObjectMapper objectMapper, DiscoveryService discoveryService) {
        this.objectMapper = objectMapper;
        this.discoveryService = discoveryService;
    }

    @RabbitListener(queues = "${wedge.runner.mq.discovery-execute-dead-letter-queue:discovery.execute.dlq}")
    public void handleDiscoveryExecuteDeadLetter(String body) {
        Optional<UUID> discoveryId = extractDiscoveryId(body);
        if (discoveryId.isEmpty()) {
            log.warn("Ignored discovery dead-letter without a valid discoveryId");
            return;
        }

        discoveryService.markStartFailedIfAwaitingRunner(discoveryId.get(), FAILURE_CODE, FAILURE_MESSAGE)
                .ifPresentOrElse(
                        discovery -> log.warn("Marked discovery failed from dead-letter discoveryId={}", discovery.getId()),
                        () -> log.info("Ignored discovery dead-letter for non-awaiting discoveryId={}", discoveryId.get())
                );
    }

    private Optional<UUID> extractDiscoveryId(String body) {
        try {
            Map<String, Object> message = objectMapper.readValue(body, new TypeReference<>() {
            });
            return firstUuid(
                    valueAt(message, "payload", "discoveryId"),
                    valueAt(message, "payload", "discovery_id"),
                    message.get("discoveryId"),
                    message.get("discovery_id"),
                    message.get("correlationId")
            );
        } catch (Exception exception) {
            log.warn("Ignored malformed discovery dead-letter payload", exception);
            return Optional.empty();
        }
    }

    private Optional<UUID> firstUuid(Object... candidates) {
        UUID resolved = null;
        for (Object candidate : candidates) {
            if (candidate instanceof String value && !value.isBlank()) {
                try {
                    UUID parsed = UUID.fromString(value.trim());
                    if (resolved != null && !resolved.equals(parsed)) {
                        return Optional.empty();
                    }
                    resolved = parsed;
                } catch (IllegalArgumentException ignored) {
                    return Optional.empty();
                }
            }
        }
        return Optional.ofNullable(resolved);
    }

    private Object valueAt(Map<String, Object> source, String... path) {
        Object current = source;
        for (String segment : path) {
            if (!(current instanceof Map<?, ?> currentMap)) {
                return null;
            }
            current = currentMap.get(segment);
        }
        return current;
    }
}
