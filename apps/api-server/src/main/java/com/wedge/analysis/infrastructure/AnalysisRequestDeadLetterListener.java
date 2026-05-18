package com.wedge.analysis.infrastructure;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.application.AnalysisRequestService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class AnalysisRequestDeadLetterListener {
    private static final Logger log = LoggerFactory.getLogger(AnalysisRequestDeadLetterListener.class);
    private static final String ERROR_CODE = "ANALYSIS_REQUEST_DEAD_LETTERED";
    private static final String ERROR_MESSAGE = "Analysis request could not be delivered to Analyzer.";

    private final ObjectMapper objectMapper;
    private final AnalysisRequestService analysisRequestService;

    public AnalysisRequestDeadLetterListener(ObjectMapper objectMapper, AnalysisRequestService analysisRequestService) {
        this.objectMapper = objectMapper;
        this.analysisRequestService = analysisRequestService;
    }

    @RabbitListener(queues = "${wedge.analyzer.mq.analysis-dead-letter-queue:analysis.dlq}")
    public void handleAnalysisRequestDeadLetter(String body) {
        AnalysisDeadLetterIds ids = extractIds(body).orElse(null);
        if (ids == null) {
            log.warn("Ignored analysis dead-letter without a valid analysisJobId");
            return;
        }

        analysisRequestService.markRequestFailedIfAwaitingAnalyzer(
                ids.analysisJobId(),
                ids.runId(),
                ERROR_CODE,
                ERROR_MESSAGE
        ).ifPresentOrElse(
                job -> log.warn("Marked analysis job failed from dead-letter analysisJobId={}", job.getId()),
                () -> log.info("Ignored analysis dead-letter for non-awaiting analysisJobId={}", ids.analysisJobId())
        );
    }

    private Optional<AnalysisDeadLetterIds> extractIds(String body) {
        try {
            Map<String, Object> message = objectMapper.readValue(body, new TypeReference<>() {
            });
            Optional<UUID> analysisJobId = firstUuid(
                    valueAt(message, "payload", "analysisJobId"),
                    valueAt(message, "payload", "analysis_job_id"),
                    message.get("analysisJobId"),
                    message.get("analysis_job_id")
            );
            if (analysisJobId.isEmpty()) {
                return Optional.empty();
            }
            UuidResolution runId = optionalUuid(
                    valueAt(message, "payload", "runId"),
                    valueAt(message, "payload", "run_id"),
                    message.get("runId"),
                    message.get("run_id")
            );
            if (!runId.valid()) {
                return Optional.empty();
            }
            return Optional.of(new AnalysisDeadLetterIds(analysisJobId.get(), runId.value()));
        } catch (Exception exception) {
            log.warn("Ignored malformed analysis dead-letter payload", exception);
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

    private UuidResolution optionalUuid(Object... candidates) {
        UUID resolved = null;
        for (Object candidate : candidates) {
            if (candidate instanceof String value && !value.isBlank()) {
                try {
                    UUID parsed = UUID.fromString(value.trim());
                    if (resolved != null && !resolved.equals(parsed)) {
                        return new UuidResolution(null, false);
                    }
                    resolved = parsed;
                } catch (IllegalArgumentException ignored) {
                    return new UuidResolution(null, false);
                }
            }
        }
        return new UuidResolution(resolved, true);
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

    private record AnalysisDeadLetterIds(UUID analysisJobId, UUID runId) {
    }

    private record UuidResolution(UUID value, boolean valid) {
    }
}
