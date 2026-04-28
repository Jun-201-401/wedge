package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.run.infrastructure.RunMapper;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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

    @Mock
    private ObservationMapper observationMapper;

    @Mock
    private RunMapper runMapper;

    @Captor
    private ArgumentCaptor<Checkpoint> checkpointCaptor;

    @Captor
    private ArgumentCaptor<Observation> observationCaptor;

    private CheckpointPersistenceService checkpointPersistenceService;

    @BeforeEach
    void setUp() {
        checkpointPersistenceService = new CheckpointPersistenceService(
                checkpointMapper,
                observationMapper,
                runMapper,
                new ObjectMapper()
        );
    }

    @Test
    void saveRunCheckpointsMapsRunnerPayloadToCheckpointRows() {
        UUID runId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "checkpoint-response-1",
                "step_003_fill_email",
                "INPUT",
                Map.of("actionType", "fill"),
                Map.of("strategy", "response", "durationMs", 216, "status", "settled"),
                216,
                Map.of("url", "https://example.com/signup"),
                List.of(Map.of("type", "form_field")),
                List.of(),
                List.of("artifact-response-screenshot")
        )));
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "checkpoint-response-1")).thenReturn(Optional.empty());

        int savedCount = checkpointPersistenceService.saveRunCheckpoints(runId, command);

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
        verify(runMapper).updateLatestCheckpoint(runId, checkpoint.getId());
    }

    @Test
    void saveRunCheckpointsPersistsNormalizedObservations() {
        UUID runId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "cp_001",
                "step_001_goto",
                "FIRST_VIEW",
                Map.of("actionType", "goto"),
                Map.of("strategy", "network_idle", "durationMs", 1200, "status", "settled"),
                1200,
                Map.of("url", "https://example.com"),
                List.of(Map.of(
                        "type", "cta_candidate",
                        "target", "text=Start free",
                        "confidence", 0.86
                )),
                List.of(Map.of("type", "last_action", "action", "goto")),
                List.of("artifact:" + UUID.randomUUID())
        )));
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "cp_001")).thenReturn(Optional.empty());

        checkpointPersistenceService.saveRunCheckpoints(runId, command);

        verify(checkpointMapper).insert(checkpointCaptor.capture());
        Checkpoint checkpoint = checkpointCaptor.getValue();
        verify(observationMapper).insert(observationCaptor.capture());
        Observation observation = observationCaptor.getValue();
        assertThat(observation.getRunId()).isEqualTo(runId);
        assertThat(observation.getCheckpointId()).isEqualTo(checkpoint.getId());
        assertThat(observation.getObservationKey()).isEqualTo("cp_001.obs_001");
        assertThat(observation.getObservationType()).isEqualTo("cta_candidate");
        assertThat(observation.getStage()).isEqualTo("CTA");
        assertThat(observation.getSourcesJsonb()).contains("dom");
        assertThat(observation.getDataJsonb()).contains("Start free");
    }

    @Test
    void saveRunCheckpointsSkipsAlreadyStoredCheckpointKey() {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        Checkpoint existingCheckpoint = new Checkpoint();
        existingCheckpoint.setId(checkpointId);
        SaveRunCheckpointsCommand command = sampleCheckpointCommand();
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "checkpoint-response-1"))
                .thenReturn(Optional.of(existingCheckpoint));

        int savedCount = checkpointPersistenceService.saveRunCheckpoints(runId, command);

        assertThat(savedCount).isEqualTo(1);
        verify(checkpointMapper, never()).insert(org.mockito.ArgumentMatchers.any());
        verify(observationMapper, never()).insert(org.mockito.ArgumentMatchers.any());
        verify(runMapper).updateLatestCheckpoint(runId, checkpointId);
    }

    private SaveRunCheckpointsCommand sampleCheckpointCommand() {
        return new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "checkpoint-response-1",
                "step_003_fill_email",
                "INPUT",
                Map.of("actionType", "fill"),
                Map.of("strategy", "response", "durationMs", 216, "status", "settled"),
                216,
                Map.of("url", "https://example.com/signup"),
                List.of(Map.of("type", "form_field")),
                List.of(),
                List.of("artifact-response-screenshot")
        )));
    }
}
