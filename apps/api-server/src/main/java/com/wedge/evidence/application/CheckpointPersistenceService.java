package com.wedge.evidence.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CheckpointPersistenceService {
    private static final String CONFIDENCE_NOT_NUMERIC_MESSAGE = "Runner checkpoint observation confidence must be numeric.";
    private static final String CONFIDENCE_OUT_OF_RANGE_MESSAGE = "Runner checkpoint observation confidence must be between 0 and 1.";
    private static final String CHECKPOINT_CONFLICT_NOT_FOUND_MESSAGE =
            "Runner checkpoint insert conflicted but no existing checkpoint was found.";

    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final ObjectMapper objectMapper;

    private record CheckpointInsertResult(UUID checkpointId, boolean inserted) {
    }

    public SaveRunCheckpointsResult saveRunCheckpoints(UUID runId, SaveRunCheckpointsCommand command) {
        return saveRunCheckpoints(runId, command, Map.of());
    }

    public SaveRunCheckpointsResult saveRunCheckpoints(UUID runId, SaveRunCheckpointsCommand command, Map<String, UUID> stepIdsByKey) {
        validateCheckpoints(command);
        OffsetDateTime capturedAt = OffsetDateTime.now();
        Optional<UUID> latestInsertedCheckpointId = Optional.empty();

        for (SaveRunCheckpointCommand checkpoint : command.checkpoints()) {
            CheckpointInsertResult insertResult = insertCheckpointIfAbsent(
                    runId,
                    checkpoint,
                    capturedAt,
                    stepIdsByKey.get(checkpoint.stepKey())
            );
            if (insertResult.inserted()) {
                latestInsertedCheckpointId = Optional.of(insertResult.checkpointId());
            }
        }

        return new SaveRunCheckpointsResult(command.checkpoints().size(), latestInsertedCheckpointId);
    }

    public int saveDiscoveryCheckpoints(UUID discoveryId, SaveRunCheckpointsCommand command) {
        validateCheckpoints(command);
        OffsetDateTime capturedAt = OffsetDateTime.now();
        for (SaveRunCheckpointCommand checkpoint : command.checkpoints()) {
            insertDiscoveryCheckpointIfAbsent(discoveryId, checkpoint, capturedAt);
        }
        return command.checkpoints().size();
    }

    private CheckpointInsertResult insertCheckpointIfAbsent(
            UUID runId,
            SaveRunCheckpointCommand request,
            OffsetDateTime capturedAt,
            UUID stepId
    ) {
        Checkpoint checkpoint = toCheckpoint(runId, request, capturedAt, stepId);
        if (checkpointMapper.insert(checkpoint) > 0) {
            persistObservations(runId, null, checkpoint, request.observations());
            return new CheckpointInsertResult(checkpoint.getId(), true);
        }

        return new CheckpointInsertResult(findExistingCheckpointId(runId, request.checkpointKey()), false);
    }

    private CheckpointInsertResult insertDiscoveryCheckpointIfAbsent(
            UUID discoveryId,
            SaveRunCheckpointCommand request,
            OffsetDateTime capturedAt
    ) {
        Checkpoint checkpoint = toDiscoveryCheckpoint(discoveryId, request, capturedAt);
        if (checkpointMapper.insertDiscovery(checkpoint) > 0) {
            persistObservations(null, discoveryId, checkpoint, request.observations());
            return new CheckpointInsertResult(checkpoint.getId(), true);
        }

        return new CheckpointInsertResult(findExistingDiscoveryCheckpointId(discoveryId, request.checkpointKey()), false);
    }

    private UUID findExistingCheckpointId(UUID runId, String checkpointKey) {
        return checkpointMapper.findByRunIdAndCheckpointKey(runId, checkpointKey)
                .map(Checkpoint::getId)
                .orElseThrow(() -> new BusinessException(ErrorCode.STATE_CONFLICT, CHECKPOINT_CONFLICT_NOT_FOUND_MESSAGE));
    }

    private UUID findExistingDiscoveryCheckpointId(UUID discoveryId, String checkpointKey) {
        return checkpointMapper.findByDiscoveryIdAndCheckpointKey(discoveryId, checkpointKey)
                .map(Checkpoint::getId)
                .orElseThrow(() -> new BusinessException(ErrorCode.STATE_CONFLICT, CHECKPOINT_CONFLICT_NOT_FOUND_MESSAGE));
    }

    private Checkpoint toCheckpoint(UUID runId, SaveRunCheckpointCommand request, OffsetDateTime capturedAt, UUID stepId) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(UUID.randomUUID());
        checkpoint.setRunId(runId);
        checkpoint.setStepId(stepId);
        checkpoint.setCheckpointKey(request.checkpointKey());
        checkpoint.setStage(request.stage());
        checkpoint.setTriggerJsonb(toJson(request.trigger()));
        checkpoint.setSettleJsonb(toJson(request.settle()));
        checkpoint.setStateJsonb(toJson(request.state()));
        checkpoint.setDeltaJsonb(toJson(request.deltas()));
        checkpoint.setArtifactRefsJsonb(toJson(request.artifactRefs()));
        checkpoint.setCapturedAt(capturedAt);
        checkpoint.setDurationMs(request.durationMs());
        return checkpoint;
    }

    private Checkpoint toDiscoveryCheckpoint(UUID discoveryId, SaveRunCheckpointCommand request, OffsetDateTime capturedAt) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(UUID.randomUUID());
        checkpoint.setDiscoveryId(discoveryId);
        checkpoint.setCheckpointKey(request.checkpointKey());
        checkpoint.setStage(request.stage());
        checkpoint.setTriggerJsonb(toJson(request.trigger()));
        checkpoint.setSettleJsonb(toJson(request.settle()));
        checkpoint.setStateJsonb(toJson(request.state()));
        checkpoint.setDeltaJsonb(toJson(request.deltas()));
        checkpoint.setArtifactRefsJsonb(toJson(request.artifactRefs()));
        checkpoint.setCapturedAt(capturedAt);
        checkpoint.setDurationMs(request.durationMs());
        return checkpoint;
    }

    private void persistObservations(UUID runId, UUID discoveryId, Checkpoint checkpoint, List<Map<String, Object>> observations) {
        for (int index = 0; index < observations.size(); index++) {
            Observation observation = toObservation(runId, discoveryId, checkpoint, observations.get(index), index + 1);
            observationMapper.insert(observation);
        }
    }

    private void validateCheckpoints(SaveRunCheckpointsCommand command) {
        for (SaveRunCheckpointCommand checkpoint : command.checkpoints()) {
            validateObservations(checkpoint.observations());
        }
    }

    private void validateObservations(List<Map<String, Object>> observations) {
        for (Map<String, Object> observation : observations) {
            parseConfidence(observation);
        }
    }

    private Observation toObservation(
            UUID runId,
            UUID discoveryId,
            Checkpoint checkpoint,
            Map<String, Object> payload,
            int observationIndex
    ) {
        Observation observation = new Observation();
        observation.setId(UUID.randomUUID());
        observation.setCheckpointId(checkpoint.getId());
        observation.setRunId(runId);
        observation.setDiscoveryId(discoveryId);
        observation.setObservationKey(readString(payload, "observation_id",
                checkpoint.getCheckpointKey() + ".obs_" + String.format("%03d", observationIndex)));
        observation.setObservationType(readString(payload, "type", "other"));
        observation.setStage(readString(
                payload,
                "stage",
                inferObservationStage(observation.getObservationType(), checkpoint.getStage())
        ));
        observation.setSourcesJsonb(toJson(readSources(payload, observation.getObservationType())));
        observation.setDataJsonb(toJson(extractObservationData(payload)));
        observation.setConfidence(parseConfidence(payload));
        return observation;
    }

    private String inferObservationStage(String observationType, String fallbackStage) {
        return switch (observationType) {
            case "cta_candidate", "cta_cluster", "cta_text_specificity" -> "CTA";
            case "form_field", "form_error", "required_field", "missing_label", "error_recovery", "submit_disabled" -> "INPUT";
            case "trust_signal", "final_submit_candidate", "terms_privacy_signal", "payment_or_sensitive_action" -> "COMMIT";
            case "value_proposition", "feature_summary", "audience_signal", "product_card", "text_block_metrics" -> "VALUE";
            case "goal_action_candidate" -> "CTA";
            default -> fallbackStage;
        };
    }

    private List<String> readSources(Map<String, Object> payload, String observationType) {
        Object source = payload.get("source");
        if (source == null) {
            source = payload.get("sources");
        }

        if (source instanceof List<?> sourceList) {
            return sourceList.stream()
                    .map(String::valueOf)
                    .toList();
        }

        return switch (observationType) {
            case "console_error" -> List.of("console");
            case "network_failure", "settle_response" -> List.of("network");
            case "cta_candidate", "form_field" -> List.of("dom");
            case "settle_item_count_change" -> List.of("scenario_log");
            case "journey_action_raw" -> List.of("scenario_log", "dom", "browser", "network");
            case "product_card" -> List.of("dom", "layout", "screenshot");
            case "goal_action_candidate" -> List.of("dom", "layout");
            case "category_filter_signal" -> List.of("scenario_log", "dom", "browser");
            case "text_block_metrics" -> List.of("dom", "layout");
            default -> List.of("scenario_log");
        };
    }

    private Map<String, Object> extractObservationData(Map<String, Object> payload) {
        Map<String, Object> data = new LinkedHashMap<>(payload);
        data.remove("observation_id");
        data.remove("type");
        data.remove("stage");
        data.remove("source");
        data.remove("sources");
        data.remove("confidence");
        return data;
    }

    private String readString(Map<String, Object> payload, String key, String defaultValue) {
        Object value = payload.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        return defaultValue;
    }

    private BigDecimal parseConfidence(Map<String, Object> payload) {
        Object value = payload.get("confidence");
        BigDecimal confidence = null;
        if (value instanceof BigDecimal decimal) {
            confidence = decimal;
        } else if (value instanceof Number number) {
            confidence = BigDecimal.valueOf(number.doubleValue());
        } else if (value instanceof String text && !text.isBlank()) {
            try {
                confidence = new BigDecimal(text);
            } catch (NumberFormatException ignored) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, CONFIDENCE_NOT_NUMERIC_MESSAGE);
            }
        }

        if (confidence == null) {
            return null;
        }

        if (confidence.compareTo(BigDecimal.ZERO) < 0 || confidence.compareTo(BigDecimal.ONE) > 0) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, CONFIDENCE_OUT_OF_RANGE_MESSAGE);
        }
        return confidence;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(
                    ErrorCode.INVALID_REQUEST,
                    "Runner checkpoint payload cannot be serialized.",
                    null,
                    exception
            );
        }
    }
}
