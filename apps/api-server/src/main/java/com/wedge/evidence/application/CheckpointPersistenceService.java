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
    private static final int FIRST_OBSERVATION_INDEX = 1;
    private static final int OBSERVATION_INDEX_INCREMENT = 1;

    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final ObjectMapper objectMapper;

    private record StoredCheckpoint(UUID id, boolean inserted) {
    }

    public SaveRunCheckpointsResult saveRunCheckpoints(UUID runId, SaveRunCheckpointsCommand command) {
        return saveRunCheckpoints(runId, command, Map.of());
    }

    public SaveRunCheckpointsResult saveRunCheckpoints(UUID runId, SaveRunCheckpointsCommand command, Map<String, UUID> stepIdsByKey) {
        validateCheckpoints(command);
        OffsetDateTime capturedAt = OffsetDateTime.now();
        Optional<UUID> latestInsertedCheckpointId = Optional.empty();

        for (SaveRunCheckpointCommand checkpoint : command.checkpoints()) {
            StoredCheckpoint storedCheckpoint = saveOrFindCheckpoint(runId, checkpoint, capturedAt, stepIdsByKey.get(checkpoint.stepKey()));
            if (storedCheckpoint.inserted()) {
                latestInsertedCheckpointId = Optional.of(storedCheckpoint.id());
            }
        }

        return new SaveRunCheckpointsResult(command.checkpoints().size(), latestInsertedCheckpointId);
    }

    private StoredCheckpoint saveOrFindCheckpoint(UUID runId, SaveRunCheckpointCommand request, OffsetDateTime capturedAt, UUID stepId) {
        Checkpoint checkpoint = toCheckpoint(runId, request, capturedAt, stepId);
        if (checkpointMapper.insert(checkpoint) > 0) {
            persistObservations(runId, checkpoint, request.observations());
            return new StoredCheckpoint(checkpoint.getId(), true);
        }

        UUID existingCheckpointId = checkpointMapper.findByRunIdAndCheckpointKey(runId, request.checkpointKey())
                .map(Checkpoint::getId)
                .orElseThrow(() -> new BusinessException(
                        ErrorCode.STATE_CONFLICT,
                        "Runner checkpoint insert conflicted but no existing checkpoint was found."
                ));
        return new StoredCheckpoint(existingCheckpointId, false);
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

    private void persistObservations(UUID runId, Checkpoint checkpoint, List<Map<String, Object>> observations) {
        int observationIndex = FIRST_OBSERVATION_INDEX;
        for (Map<String, Object> observationPayload : observations) {
            Observation observation = toObservation(runId, checkpoint, observationPayload, observationIndex);
            observationMapper.insert(observation);
            observationIndex += OBSERVATION_INDEX_INCREMENT;
        }
    }

    private void validateCheckpoints(SaveRunCheckpointsCommand command) {
        for (SaveRunCheckpointCommand checkpoint : command.checkpoints()) {
            validateObservations(checkpoint.observations());
        }
    }

    private void validateObservations(List<Map<String, Object>> observations) {
        for (Map<String, Object> observation : observations) {
            readConfidence(observation);
        }
    }

    private Observation toObservation(
            UUID runId,
            Checkpoint checkpoint,
            Map<String, Object> payload,
            int observationIndex
    ) {
        Observation observation = new Observation();
        observation.setId(UUID.randomUUID());
        observation.setCheckpointId(checkpoint.getId());
        observation.setRunId(runId);
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
        observation.setConfidence(readConfidence(payload));
        return observation;
    }

    private String inferObservationStage(String observationType, String fallbackStage) {
        return switch (observationType) {
            case "cta_candidate", "cta_cluster", "cta_text_specificity" -> "CTA";
            case "form_field", "form_error", "required_field", "missing_label", "error_recovery", "submit_disabled" -> "INPUT";
            case "trust_signal", "final_submit_candidate", "terms_privacy_signal", "payment_or_sensitive_action" -> "COMMIT";
            case "value_proposition", "feature_summary", "audience_signal" -> "VALUE";
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

    private BigDecimal readConfidence(Map<String, Object> payload) {
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
                throw new BusinessException(
                        ErrorCode.INVALID_REQUEST,
                        "Runner checkpoint observation confidence must be numeric."
                );
            }
        }

        if (confidence == null) {
            return null;
        }

        if (confidence.compareTo(BigDecimal.ZERO) < 0 || confidence.compareTo(BigDecimal.ONE) > 0) {
            throw new BusinessException(
                    ErrorCode.INVALID_REQUEST,
                    "Runner checkpoint observation confidence must be between 0 and 1."
            );
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
