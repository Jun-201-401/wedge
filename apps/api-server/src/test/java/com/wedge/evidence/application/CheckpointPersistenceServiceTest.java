package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import java.math.BigDecimal;
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
        when(checkpointMapper.insert(any(Checkpoint.class))).thenReturn(1);

        SaveRunCheckpointsResult result = checkpointPersistenceService.saveRunCheckpoints(runId, command);

        assertThat(result.checkpointCount()).isEqualTo(1);
        verify(checkpointMapper).insert(checkpointCaptor.capture());
        Checkpoint checkpoint = checkpointCaptor.getValue();
        assertThat(result.latestInsertedCheckpointId()).contains(checkpoint.getId());
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
        when(checkpointMapper.insert(any(Checkpoint.class))).thenReturn(1);

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
        assertThat(observation.getConfidence()).isEqualByComparingTo("0.86");
    }

    @Test
    void saveRunCheckpointsPreservesJourneyRawObservationDataAndDefaultSources() {
        UUID runId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "cp_journey",
                "step_click_cart",
                "CTA",
                Map.of("actionType", "click"),
                Map.of("strategy", "response", "durationMs", 180, "status", "settled"),
                180,
                Map.of("url", "https://example.com/products/sku-1"),
                List.of(Map.ofEntries(
                        Map.entry("observation_id", "step_click_cart.obs_journey_action_raw"),
                        Map.entry("type", "journey_action_raw"),
                        Map.entry("confidence", 0.82),
                        Map.entry("clicked_text", "장바구니 담기"),
                        Map.entry("clicked_selector", "button.add-cart"),
                        Map.entry("url_before", "https://example.com"),
                        Map.entry("url_after", "https://example.com/products/sku-1"),
                        Map.entry("cart_count_before", 0),
                        Map.entry("cart_count_after", 1),
                        Map.entry("dom_changed", true),
                        Map.entry("settle_status", "settled")
                )),
                List.of(),
                List.of("artifact-screenshot")
        )));
        when(checkpointMapper.insert(any(Checkpoint.class))).thenReturn(1);

        checkpointPersistenceService.saveRunCheckpoints(runId, command);

        verify(observationMapper).insert(observationCaptor.capture());
        Observation observation = observationCaptor.getValue();
        assertThat(observation.getObservationKey()).isEqualTo("step_click_cart.obs_journey_action_raw");
        assertThat(observation.getObservationType()).isEqualTo("journey_action_raw");
        assertThat(observation.getStage()).isEqualTo("CTA");
        assertThat(observation.getSourcesJsonb()).contains("scenario_log", "dom", "browser", "network");
        assertThat(observation.getDataJsonb()).contains(
                "장바구니 담기",
                "button.add-cart",
                "url_before",
                "cart_count_after",
                "dom_changed"
        );
        assertThat(observation.getDataJsonb()).doesNotContain("observation_id", "\"type\"", "\"confidence\"");
    }

    @Test
    void saveRunCheckpointsSkipsAlreadyStoredCheckpointKeyWithoutLatestCandidate() {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        Checkpoint existingCheckpoint = new Checkpoint();
        existingCheckpoint.setId(checkpointId);
        SaveRunCheckpointsCommand command = sampleCheckpointCommand();
        when(checkpointMapper.insert(any(Checkpoint.class))).thenReturn(0);
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "checkpoint-response-1"))
                .thenReturn(Optional.of(existingCheckpoint));

        SaveRunCheckpointsResult result = checkpointPersistenceService.saveRunCheckpoints(runId, command);

        assertThat(result.checkpointCount()).isEqualTo(1);
        assertThat(result.latestInsertedCheckpointId()).isEmpty();
        verify(observationMapper, never()).insert(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void saveRunCheckpointsKeepsNewestInsertedCheckpointWhenBatchEndsWithDuplicate() {
        UUID runId = UUID.randomUUID();
        UUID existingCheckpointId = UUID.randomUUID();
        Checkpoint existingCheckpoint = new Checkpoint();
        existingCheckpoint.setId(existingCheckpointId);
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(
                checkpointCommand("cp_003", "step_003", "COMMIT", List.of()),
                checkpointCommand("cp_001", "step_001", "FIRST_VIEW", List.of())
        ));
        when(checkpointMapper.insert(any(Checkpoint.class))).thenReturn(1, 0);
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "cp_001"))
                .thenReturn(Optional.of(existingCheckpoint));

        SaveRunCheckpointsResult result = checkpointPersistenceService.saveRunCheckpoints(runId, command);

        assertThat(result.checkpointCount()).isEqualTo(2);
        verify(checkpointMapper, org.mockito.Mockito.times(2)).insert(checkpointCaptor.capture());
        Checkpoint insertedCheckpoint = checkpointCaptor.getAllValues().get(0);
        assertThat(insertedCheckpoint.getCheckpointKey()).isEqualTo("cp_003");
        assertThat(result.latestInsertedCheckpointId()).contains(insertedCheckpoint.getId());
        assertThat(result.latestInsertedCheckpointId().orElseThrow()).isNotEqualTo(existingCheckpointId);
        verifyNoInteractions(observationMapper);
    }

    @Test
    void saveDiscoveryCheckpointsSkipsAlreadyStoredCheckpointKey() {
        UUID discoveryId = UUID.randomUUID();
        UUID existingCheckpointId = UUID.randomUUID();
        Checkpoint existingCheckpoint = new Checkpoint();
        existingCheckpoint.setId(existingCheckpointId);
        SaveRunCheckpointsCommand command = sampleCheckpointCommand();
        when(checkpointMapper.insertDiscovery(any(Checkpoint.class))).thenReturn(0);
        when(checkpointMapper.findByDiscoveryIdAndCheckpointKey(discoveryId, "checkpoint-response-1"))
                .thenReturn(Optional.of(existingCheckpoint));

        int savedCount = checkpointPersistenceService.saveDiscoveryCheckpoints(discoveryId, command);

        assertThat(savedCount).isEqualTo(1);
        verify(observationMapper, never()).insert(any());
    }

    @Test
    void saveRunCheckpointsRejectsConfidenceBelowZero() {
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(
                checkpointCommand("cp_invalid", "step_001", "CTA", List.of(Map.of(
                        "type", "cta_candidate",
                        "confidence", -0.01
                )))
        ));

        assertThatThrownBy(() -> checkpointPersistenceService.saveRunCheckpoints(UUID.randomUUID(), command))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Runner checkpoint observation confidence must be between 0 and 1.");

        verifyNoInteractions(checkpointMapper, observationMapper);
    }

    @Test
    void saveRunCheckpointsRejectsConfidenceAboveOne() {
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(
                checkpointCommand("cp_invalid", "step_001", "CTA", List.of(Map.of(
                        "type", "cta_candidate",
                        "confidence", "1.01"
                )))
        ));

        assertThatThrownBy(() -> checkpointPersistenceService.saveRunCheckpoints(UUID.randomUUID(), command))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Runner checkpoint observation confidence must be between 0 and 1.");

        verifyNoInteractions(checkpointMapper, observationMapper);
    }

    @Test
    void saveRunCheckpointsRejectsNonNumericConfidenceString() {
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(
                checkpointCommand("cp_invalid", "step_001", "CTA", List.of(Map.of(
                        "type", "cta_candidate",
                        "confidence", "high"
                )))
        ));

        assertThatThrownBy(() -> checkpointPersistenceService.saveRunCheckpoints(UUID.randomUUID(), command))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Runner checkpoint observation confidence must be numeric.");

        verifyNoInteractions(checkpointMapper, observationMapper);
    }

    @Test
    void saveRunCheckpointsAcceptsConfidenceBounds() {
        UUID runId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "cp_bounds",
                "step_001",
                "CTA",
                Map.of("actionType", "click"),
                Map.of("strategy", "response", "durationMs", 216, "status", "settled"),
                216,
                Map.of("url", "https://example.com/signup"),
                List.of(
                        Map.of("type", "cta_candidate", "confidence", BigDecimal.ZERO),
                        Map.of("type", "cta_candidate", "confidence", BigDecimal.ONE)
                ),
                List.of(),
                List.of()
        )));
        when(checkpointMapper.insert(any(Checkpoint.class))).thenReturn(1);

        checkpointPersistenceService.saveRunCheckpoints(runId, command);

        verify(observationMapper, org.mockito.Mockito.times(2)).insert(observationCaptor.capture());
        assertThat(observationCaptor.getAllValues())
                .extracting(Observation::getConfidence)
                .containsExactly(BigDecimal.ZERO, BigDecimal.ONE);
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

    private SaveRunCheckpointCommand checkpointCommand(
            String checkpointKey,
            String stepKey,
            String stage,
            List<Map<String, Object>> observations
    ) {
        return new SaveRunCheckpointCommand(
                checkpointKey,
                stepKey,
                stage,
                Map.of("actionType", "click"),
                Map.of("strategy", "response", "durationMs", 216, "status", "settled"),
                216,
                Map.of("url", "https://example.com/signup"),
                observations,
                List.of(),
                List.of()
        );
    }
}
