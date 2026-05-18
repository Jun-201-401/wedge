package com.wedge.scenarioauthoring.infrastructure;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringCallbackService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class ScenarioAuthoringExecutionDeadLetterListener {
    private static final Logger log = LoggerFactory.getLogger(ScenarioAuthoringExecutionDeadLetterListener.class);
    private static final String FAILURE_CODE = "SCENARIO_AUTHORING_REQUEST_DEAD_LETTERED";
    private static final String FAILURE_MESSAGE = "Scenario authoring request could not be delivered to Runner.";

    private final ObjectMapper objectMapper;
    private final ScenarioAuthoringCallbackService scenarioAuthoringCallbackService;

    public ScenarioAuthoringExecutionDeadLetterListener(
            ObjectMapper objectMapper,
            ScenarioAuthoringCallbackService scenarioAuthoringCallbackService
    ) {
        this.objectMapper = objectMapper;
        this.scenarioAuthoringCallbackService = scenarioAuthoringCallbackService;
    }

    @RabbitListener(queues = "${wedge.runner.mq.scenario-authoring-execute-dead-letter-queue:scenario-authoring.execute.dlq}")
    public void handleScenarioAuthoringExecuteDeadLetter(String body) {
        Optional<UUID> authoringJobId = extractAuthoringJobId(body);
        if (authoringJobId.isEmpty()) {
            log.warn("Ignored scenario-authoring dead-letter without a valid authoringJobId");
            return;
        }

        scenarioAuthoringCallbackService.markStartFailedIfAwaitingRunner(authoringJobId.get(), FAILURE_CODE, FAILURE_MESSAGE)
                .ifPresentOrElse(
                        job -> log.warn("Marked scenario-authoring job failed from dead-letter authoringJobId={}", job.getId()),
                        () -> log.info("Ignored scenario-authoring dead-letter for non-awaiting authoringJobId={}", authoringJobId.get())
                );
    }

    private Optional<UUID> extractAuthoringJobId(String body) {
        try {
            Map<String, Object> message = objectMapper.readValue(body, new TypeReference<>() {
            });
            return firstUuid(
                    valueAt(message, "payload", "authoringJobId"),
                    valueAt(message, "payload", "authoring_job_id"),
                    message.get("authoringJobId"),
                    message.get("authoring_job_id")
            );
        } catch (Exception exception) {
            log.warn("Ignored malformed scenario-authoring dead-letter payload", exception);
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
