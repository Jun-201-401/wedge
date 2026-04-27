package com.wedge.evidence.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.internal.runner.dto.RunnerCheckpointRequest;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CheckpointPersistenceService {
    private final CheckpointMapper checkpointMapper;
    private final ObjectMapper objectMapper;

    public CheckpointPersistenceService(CheckpointMapper checkpointMapper, ObjectMapper objectMapper) {
        this.checkpointMapper = checkpointMapper;
        this.objectMapper = objectMapper;
    }

    public int saveRunCheckpoints(UUID runId, RunnerCheckpointsRequest request) {
        OffsetDateTime capturedAt = OffsetDateTime.now();
        request.checkpoints().forEach(checkpoint -> saveIfAbsent(runId, checkpoint, capturedAt));
        return request.checkpoints().size();
    }

    private void saveIfAbsent(UUID runId, RunnerCheckpointRequest request, OffsetDateTime capturedAt) {
        if (checkpointMapper.findByRunIdAndCheckpointKey(runId, request.checkpointId()).isPresent()) {
            return;
        }

        checkpointMapper.insert(toCheckpoint(runId, request, capturedAt));
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
