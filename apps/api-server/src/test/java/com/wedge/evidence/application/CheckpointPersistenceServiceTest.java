package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.internal.runner.dto.RunnerCheckpointRequest;
import com.wedge.internal.runner.dto.RunnerCheckpointStage;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerSettleInfo;
import com.wedge.internal.runner.dto.RunnerSettleStatus;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CheckpointPersistenceServiceTest {
    @Mock
    private CheckpointMapper checkpointMapper;

    @Captor
    private ArgumentCaptor<Checkpoint> checkpointCaptor;

    private CheckpointPersistenceService checkpointPersistenceService;

    @BeforeEach
    void setUp() {
        checkpointPersistenceService = new CheckpointPersistenceService(checkpointMapper, new ObjectMapper());
    }

    @Test
    void saveRunCheckpointsMapsRunnerPayloadToCheckpointRows() {
        UUID runId = UUID.randomUUID();
        RunnerCheckpointsRequest request = new RunnerCheckpointsRequest(List.of(new RunnerCheckpointRequest(
                "checkpoint-response-1",
                "step_003_fill_email",
                RunnerCheckpointStage.INPUT,
                Map.of("actionType", "fill"),
                new RunnerSettleInfo("response", 216, RunnerSettleStatus.settled),
                Map.of("url", "https://example.com/signup"),
                List.of(Map.of("type", "form_field")),
                List.of(),
                List.of("artifact-response-screenshot")
        )));

        int savedCount = checkpointPersistenceService.saveRunCheckpoints(runId, request);

        assertThat(savedCount).isEqualTo(1);
        verify(checkpointMapper).insert(checkpointCaptor.capture());
        Checkpoint checkpoint = checkpointCaptor.getValue();
        assertThat(checkpoint.getId()).isNotNull();
        assertThat(checkpoint.getRunId()).isEqualTo(runId);
        assertThat(checkpoint.getStepId()).isNull();
        assertThat(checkpoint.getCheckpointKey()).isEqualTo("checkpoint-response-1");
        assertThat(checkpoint.getStage()).isEqualTo("INPUT");
        assertThat(checkpoint.getTriggerJsonb()).contains("\"actionType\":\"fill\"");
        assertThat(checkpoint.getSettleJsonb()).contains("\"durationMs\":216", "\"status\":\"settled\"");
        assertThat(checkpoint.getStateJsonb()).contains("\"url\":\"https://example.com/signup\"");
        assertThat(checkpoint.getDeltaJsonb()).isEqualTo("[]");
        assertThat(checkpoint.getArtifactRefsJsonb()).contains("artifact-response-screenshot");
        assertThat(checkpoint.getCapturedAt()).isNotNull();
        assertThat(checkpoint.getDurationMs()).isEqualTo(216);
    }

    @Test
    void saveRunCheckpointsSkipsAlreadyStoredCheckpointKey() {
        UUID runId = UUID.randomUUID();
        RunnerCheckpointsRequest request = sampleCheckpointRequest();
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "checkpoint-response-1"))
                .thenReturn(java.util.Optional.of(new Checkpoint()));

        int savedCount = checkpointPersistenceService.saveRunCheckpoints(runId, request);

        assertThat(savedCount).isEqualTo(1);
        verify(checkpointMapper, never()).insert(org.mockito.ArgumentMatchers.any());
    }

    private RunnerCheckpointsRequest sampleCheckpointRequest() {
        return new RunnerCheckpointsRequest(List.of(new RunnerCheckpointRequest(
                "checkpoint-response-1",
                "step_003_fill_email",
                RunnerCheckpointStage.INPUT,
                Map.of("actionType", "fill"),
                new RunnerSettleInfo("response", 216, RunnerSettleStatus.settled),
                Map.of("url", "https://example.com/signup"),
                List.of(Map.of("type", "form_field")),
                List.of(),
                List.of("artifact-response-screenshot")
        )));
    }
}
