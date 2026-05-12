package com.wedge.scenarioauthoring.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.common.internal.InternalCallbackContext;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringJob;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import com.wedge.scenarioauthoring.infrastructure.ScenarioAuthoringJobMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ScenarioAuthoringCallbackService {
    private static final String ACCEPTED_CONSUMER = "runner.scenario-authoring.accepted";
    private static final String FINISHED_CONSUMER = "runner.scenario-authoring.finished";
    private static final String FAILED_CONSUMER = "runner.scenario-authoring.failed";

    private final ScenarioAuthoringJobMapper scenarioAuthoringJobMapper;
    private final ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;
    private final ObjectMapper objectMapper;

    @Transactional
    public ScenarioAuthoringCallbackAckResponse handleAccepted(UUID authoringJobId, String workerId, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(workerId);
        ScenarioAuthoringCallbackAckResponse duplicate = duplicateStatusResponse(ACCEPTED_CONSUMER, context.eventId(), authoringJobId);
        if (duplicate != null) {
            return duplicate;
        }
        ScenarioAuthoringJob job = findJob(authoringJobId);
        if (job.getStatus() == ScenarioAuthoringStatus.RUNNING) {
            return ScenarioAuthoringCallbackAckResponse.status(authoringJobId, ScenarioAuthoringStatus.RUNNING);
        }
        if (job.getStatus() != ScenarioAuthoringStatus.QUEUED && job.getStatus() != ScenarioAuthoringStatus.CREATED) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring job cannot be accepted from its current state.");
        }
        int updated = scenarioAuthoringJobMapper.markRunning(authoringJobId);
        if (updated == 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring job state changed during accepted callback.");
        }
        return ScenarioAuthoringCallbackAckResponse.status(authoringJobId, ScenarioAuthoringStatus.RUNNING);
    }

    @Transactional
    public ScenarioAuthoringCallbackAckResponse handleFinished(UUID authoringJobId, Map<String, Object> payload, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(String.valueOf(payload.get("workerId")));
        ScenarioAuthoringCallbackAckResponse duplicate = duplicateStatusResponse(FINISHED_CONSUMER, context.eventId(), authoringJobId);
        if (duplicate != null) {
            return duplicate;
        }
        List<?> candidates = readList(payload.get("candidates"));
        Map<String, Object> validation = readMap(payload.get("validation"));
        ScenarioAuthoringStatus status = validationPassed(validation, candidates) ? ScenarioAuthoringStatus.SUCCEEDED : ScenarioAuthoringStatus.FAILED;
        Map<String, Object> failure = status == ScenarioAuthoringStatus.FAILED
                ? Map.of("failure_code", "candidate_validation_failed", "failure_message", "Runner ScenarioAuthoring candidate failed validation.", "provider_type", "RULE_BASED")
                : null;
        int updated = scenarioAuthoringJobMapper.completeFromRunner(
                authoringJobId,
                status.name(),
                toJson(payload.getOrDefault("providerTrace", List.of())),
                toJson(candidates),
                toJson(validation),
                toJson(payload.getOrDefault("provenance", Map.of())),
                failure == null ? "null" : toJson(failure)
        );
        if (updated == 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring job cannot be completed from its current state.");
        }
        return ScenarioAuthoringCallbackAckResponse.finished(authoringJobId, status, candidates.size());
    }

    @Transactional
    public ScenarioAuthoringCallbackAckResponse handleFailed(UUID authoringJobId, Map<String, Object> payload, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(String.valueOf(payload.get("workerId")));
        ScenarioAuthoringCallbackAckResponse duplicate = duplicateStatusResponse(FAILED_CONSUMER, context.eventId(), authoringJobId);
        if (duplicate != null) {
            return duplicate;
        }
        Map<String, Object> failure = readMap(payload.get("failure"));
        int updated = scenarioAuthoringJobMapper.failFromRunner(
                authoringJobId,
                toJson(payload.getOrDefault("providerTrace", List.of())),
                toJson(payload.getOrDefault("validation", failedValidation(failure))),
                toJson(payload.getOrDefault("provenance", Map.of())),
                toJson(failure.isEmpty() ? Map.of("failure_code", "SCENARIO_AUTHORING_FAILED", "failure_message", "Runner ScenarioAuthoring failed.") : failure)
        );
        if (updated == 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring job cannot be failed from its current state.");
        }
        return ScenarioAuthoringCallbackAckResponse.status(authoringJobId, ScenarioAuthoringStatus.FAILED);
    }

    private ScenarioAuthoringCallbackAckResponse duplicateStatusResponse(String consumerName, String eventId, UUID authoringJobId) {
        if (processedMessagePersistenceAdapter.tryMarkProcessed(consumerName, eventId)) {
            return null;
        }
        return ScenarioAuthoringCallbackAckResponse.duplicate(authoringJobId, findJob(authoringJobId).getStatus());
    }

    private ScenarioAuthoringJob findJob(UUID authoringJobId) {
        return scenarioAuthoringJobMapper.findById(authoringJobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SCENARIO_AUTHORING_JOB_NOT_FOUND));
    }

    private boolean validationPassed(Map<String, Object> validation, List<?> candidates) {
        return !candidates.isEmpty()
                && Boolean.TRUE.equals(validation.get("schema_valid"))
                && Boolean.TRUE.equals(validation.get("safety_valid"))
                && Boolean.TRUE.equals(validation.get("fit_requirements_valid"))
                && readList(validation.get("errors")).isEmpty();
    }

    private Map<String, Object> failedValidation(Map<String, Object> failure) {
        return Map.of(
                "schema_valid", false,
                "safety_valid", false,
                "fit_requirements_valid", false,
                "errors", List.of(Map.of("code", failure.getOrDefault("failure_code", "SCENARIO_AUTHORING_FAILED"), "message", failure.getOrDefault("failure_message", "Runner ScenarioAuthoring failed."))),
                "warnings", List.of()
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private List<?> readList(Object value) {
        return value instanceof List<?> list ? list : List.of();
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to serialize ScenarioAuthoring callback payload.", null, exception);
        }
    }
}
