package com.wedge.evidence.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.internal.runner.dto.RunnerCheckpointRequest;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.run.infrastructure.RunMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CheckpointPersistenceService {
    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final RunMapper runMapper;
    private final ObjectMapper objectMapper;

    public CheckpointPersistenceService(
            CheckpointMapper checkpointMapper,
            ObservationMapper observationMapper,
            RunMapper runMapper,
            ObjectMapper objectMapper
    ) {
        this.checkpointMapper = checkpointMapper;
        this.observationMapper = observationMapper;
        this.runMapper = runMapper;
        this.objectMapper = objectMapper;
    }

    public int saveRunCheckpoints(UUID runId, RunnerCheckpointsRequest request) {
        OffsetDateTime capturedAt = OffsetDateTime.now();
        UUID latestCheckpointId = null;

        for (RunnerCheckpointRequest checkpointRequest : request.checkpoints()) {
            latestCheckpointId = saveOrFindCheckpointId(runId, checkpointRequest, capturedAt);
        }

        if (latestCheckpointId != null) {
            runMapper.updateLatestCheckpoint(runId, latestCheckpointId);
        }
        return request.checkpoints().size();
    }

    private UUID saveOrFindCheckpointId(UUID runId, RunnerCheckpointRequest request, OffsetDateTime capturedAt) {
        Optional<Checkpoint> existingCheckpoint = checkpointMapper.findByRunIdAndCheckpointKey(
                runId,
                request.checkpointId()
        );
        if (existingCheckpoint.isPresent()) {
            return existingCheckpoint.get().getId();
        }

        Checkpoint checkpoint = toCheckpoint(runId, request, capturedAt);
        checkpointMapper.insert(checkpoint);
        persistObservations(runId, checkpoint, request.observations());
        return checkpoint.getId();
    }

    private Checkpoint toCheckpoint(UUID runId, RunnerCheckpointRequest request, OffsetDateTime capturedAt) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(UUID.randomUUID());
        checkpoint.setRunId(runId);
        checkpoint.setCheckpointKey(request.checkpointId());
        checkpoint.setStage(request.stage().name());
        checkpoint.setTriggerJsonb(toJson(request.trigger()));
        checkpoint.setSettleJsonb(toJson(request.settle()));
        checkpoint.setStateJsonb(toJson(request.state()));
        checkpoint.setDeltaJsonb(toJson(request.deltas()));
        checkpoint.setArtifactRefsJsonb(toJson(request.artifactRefs()));
        checkpoint.setCapturedAt(capturedAt);
        checkpoint.setDurationMs(request.settle().durationMs());
        return checkpoint;
    }

    private void persistObservations(UUID runId, Checkpoint checkpoint, List<Map<String, Object>> observations) {
        int observationIndex = 1;
        for (Map<String, Object> observationPayload : observations) {
            Observation observation = toObservation(runId, checkpoint, observationPayload, observationIndex);
            observationMapper.insert(observation);
            observationIndex += 1;
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
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue());
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return new BigDecimal(text);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
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
