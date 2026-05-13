package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.run.application.RunFailureCodes;
import com.wedge.run.application.RunService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class RunnerExecutionDeadLetterListener {
    private static final Logger log = LoggerFactory.getLogger(RunnerExecutionDeadLetterListener.class);
    private static final String START_FAILURE_MESSAGE = "요청을 시작하지 못했습니다.";

    private final ObjectMapper objectMapper;
    private final RunService runService;

    public RunnerExecutionDeadLetterListener(ObjectMapper objectMapper, RunService runService) {
        this.objectMapper = objectMapper;
        this.runService = runService;
    }

    @RabbitListener(queues = "${wedge.runner.mq.run-execute-dead-letter-queue:run.execute.dlq}")
    public void handleRunExecuteDeadLetter(String body) {
        handleDeadLetter("run.execute.dlq", body);
    }

    @RabbitListener(queues = "${wedge.runner.mq.agent-execute-dead-letter-queue:agent.execute.dlq}")
    public void handleAgentExecuteDeadLetter(String body) {
        handleDeadLetter("agent.execute.dlq", body);
    }

    private void handleDeadLetter(String queueName, String body) {
        Optional<UUID> runId = extractRunId(body);
        if (runId.isEmpty()) {
            log.warn("Ignored runner execution dead-letter without a valid runId queue={}", queueName);
            return;
        }

        runService.markStartFailedIfAwaitingRunner(
                runId.get(),
                RunFailureCodes.RUN_START_FAILED,
                START_FAILURE_MESSAGE
        ).ifPresentOrElse(
                run -> log.warn("Marked run start failed from runner dead-letter queue={} runId={}", queueName, run.id()),
                () -> log.info("Ignored runner dead-letter for non-awaiting run queue={} runId={}", queueName, runId.get())
        );
    }

    private Optional<UUID> extractRunId(String body) {
        try {
            Map<String, Object> message = objectMapper.readValue(body, new TypeReference<>() {
            });
            return firstUuid(
                    valueAt(message, "payload", "runId"),
                    valueAt(message, "payload", "agentTask", "run_id"),
                    valueAt(message, "payload", "agentTask", "runId"),
                    valueAt(message, "payload", "run_id"),
                    message.get("runId"),
                    message.get("run_id")
            );
        } catch (Exception exception) {
            log.warn("Ignored malformed runner execution dead-letter payload", exception);
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
