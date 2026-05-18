package com.wedge.discovery.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.common.internal.InternalCallbackContext;
import com.wedge.discovery.application.command.DiscoveryAcceptedCommand;
import com.wedge.discovery.application.command.DiscoveryFailedCommand;
import com.wedge.discovery.application.command.DiscoveryFinishedCommand;
import com.wedge.discovery.application.command.DiscoveryRecommendationCommand;
import com.wedge.discovery.application.command.DiscoverySummaryCommand;
import com.wedge.discovery.domain.DiscoveryStatus;
import com.wedge.discovery.domain.ScenarioRecommendation;
import com.wedge.discovery.domain.SiteDiscovery;
import com.wedge.discovery.infrastructure.ScenarioRecommendationMapper;
import com.wedge.discovery.infrastructure.SiteDiscoveryMapper;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.evidence.application.command.SaveRunCheckpointCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DiscoveryCallbackServiceTest {
    private static final String WORKER_ID = "runner_001";
    private static final String SIGNATURE = "hmac-sha256=sig";

    @Mock
    private DiscoveryService discoveryService;

    @Mock
    private SiteDiscoveryMapper siteDiscoveryMapper;

    @Mock
    private ScenarioRecommendationMapper scenarioRecommendationMapper;

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    @Mock
    private CheckpointPersistenceService checkpointPersistenceService;

    private DiscoveryCallbackService discoveryCallbackService;

    @BeforeEach
    void setUp() {
        discoveryCallbackService = new DiscoveryCallbackService(
                discoveryService,
                siteDiscoveryMapper,
                scenarioRecommendationMapper,
                processedMessagePersistenceAdapter,
                checkpointPersistenceService,
                new ObjectMapper()
        );
    }

    @Test
    void acceptedCallbackTransitionsQueuedDiscoveryToRunning() {
        UUID discoveryId = UUID.randomUUID();
        SiteDiscovery discovery = discovery(discoveryId, DiscoveryStatus.QUEUED);
        OffsetDateTime acceptedAt = OffsetDateTime.parse("2026-04-21T10:00:00+09:00");
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.accepted"), eq("evt_accepted_001"), any())).thenReturn(true);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery);
        when(siteDiscoveryMapper.markRunning(discoveryId, acceptedAt)).thenReturn(1);

        DiscoveryCallbackAckResponse response = discoveryCallbackService.handleAccepted(
                discoveryId,
                new DiscoveryAcceptedCommand(WORKER_ID, acceptedAt, "browser-1"),
                headers("evt_accepted_001")
        );

        assertThat(response.status()).isEqualTo(DiscoveryStatus.RUNNING);
        verify(siteDiscoveryMapper).markRunning(discoveryId, acceptedAt);
    }

    @Test
    void acceptedCallbackDoesNotRegressCompletedDiscoveryToRunning() {
        UUID discoveryId = UUID.randomUUID();
        OffsetDateTime acceptedAt = OffsetDateTime.parse("2026-04-21T10:00:00+09:00");
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.accepted"), eq("evt_accepted_001"), any())).thenReturn(true);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.COMPLETED));

        assertThatThrownBy(() -> discoveryCallbackService.handleAccepted(
                discoveryId,
                new DiscoveryAcceptedCommand(WORKER_ID, acceptedAt, "browser-1"),
                headers("evt_accepted_001")
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Discovery cannot be accepted from its current state.");
        verify(siteDiscoveryMapper, never()).markRunning(discoveryId, acceptedAt);
    }

    @Test
    void checkpointCallbackPersistsDiscoveryCheckpoints() {
        UUID discoveryId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "cp_001",
                "discovery",
                "FIRST_VIEW",
                Map.of("source", "discovery"),
                Map.of("durationMs", 10, "status", "settled"),
                10,
                Map.of("url", "https://example.com"),
                List.of(Map.of("type", "cta_candidate")),
                List.of(),
                List.of()
        )));
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.checkpoints"), eq("evt_checkpoint_001"), any())).thenReturn(true);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.RUNNING));
        when(checkpointPersistenceService.saveDiscoveryCheckpoints(discoveryId, command)).thenReturn(1);

        DiscoveryCallbackAckResponse response = discoveryCallbackService.handleCheckpoints(
                discoveryId,
                WORKER_ID,
                command,
                headers("evt_checkpoint_001")
        );

        assertThat(response.checkpointCount()).isEqualTo(1);
        verify(checkpointPersistenceService).saveDiscoveryCheckpoints(discoveryId, command);
    }

    @Test
    void checkpointCallbackRejectsLateEvidenceAfterDiscoveryIsTerminal() {
        UUID discoveryId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "cp_001",
                "discovery",
                "FIRST_VIEW",
                Map.of("source", "discovery"),
                Map.of("durationMs", 10, "status", "settled"),
                10,
                Map.of("url", "https://example.com"),
                List.of(Map.of("type", "cta_candidate")),
                List.of(),
                List.of()
        )));
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.checkpoints"), eq("evt_late_checkpoint_001"), any())).thenReturn(true);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.COMPLETED));

        assertThatThrownBy(() -> discoveryCallbackService.handleCheckpoints(
                discoveryId,
                WORKER_ID,
                command,
                headers("evt_late_checkpoint_001")
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Discovery evidence cannot be accepted after the discovery is terminal.");

        verify(checkpointPersistenceService, never()).saveDiscoveryCheckpoints(discoveryId, command);
    }

    @Test
    void finishedCallbackPersistsRecommendationEvidenceSummary() {
        UUID discoveryId = UUID.randomUUID();
        Map<String, Object> evidenceSummary = Map.of(
                "matched_signals", List.of(Map.of(
                        "signal_id", "sig_001",
                        "source", "aria_label",
                        "signal_type", "contact_keyword",
                        "value", "Book a demo",
                        "evidence_ref", "cp_001.obs_003",
                        "weight", 0.3
                )),
                "missing_signals", List.of("safe_submit_boundary_not_verified"),
                "limitations", List.of("image_text_ocr_not_performed")
        );
        DiscoveryFinishedCommand command = new DiscoveryFinishedCommand(
                WORKER_ID,
                OffsetDateTime.parse("2026-04-21T10:05:00+09:00"),
                "https://example.com",
                new DiscoverySummaryCommand(
                        List.of("CONTACT"),
                        List.of(),
                        0,
                        0,
                        0,
                        0,
                        List.of(new DiscoveryRecommendationCommand(
                                "CONTACT",
                                "HIGH",
                                new java.math.BigDecimal("0.86"),
                                "Contact candidate was found.",
                                List.of("cp_001.obs_003"),
                                evidenceSummary,
                                "https://example.com",
                                Map.of("text", "Book a demo")
                        ))
                )
        );
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.finished"), eq("evt_finished_001"), any())).thenReturn(true);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.RUNNING));
        when(siteDiscoveryMapper.markCompleted(discoveryId, "https://example.com", "{\"detectedFlowTypes\":[\"CONTACT\"],\"missingFlowTypes\":[],\"primaryCtaCount\":0,\"formCandidateCount\":0,\"pricingEntrypointCount\":0,\"checkoutEntrypointCount\":0}", command.finishedAt())).thenReturn(1);

        discoveryCallbackService.handleFinished(discoveryId, command, headers("evt_finished_001"));

        ArgumentCaptor<ScenarioRecommendation> recommendationCaptor = ArgumentCaptor.forClass(ScenarioRecommendation.class);
        verify(scenarioRecommendationMapper).insert(recommendationCaptor.capture());
        assertThat(recommendationCaptor.getValue().getEvidenceSummaryJsonb()).contains("matched_signals", "Book a demo", "image_text_ocr_not_performed");
    }

    @Test
    void duplicateAcceptedCallbackDoesNotTransitionDiscoveryAgain() {
        UUID discoveryId = UUID.randomUUID();
        OffsetDateTime acceptedAt = OffsetDateTime.parse("2026-04-21T10:00:00+09:00");
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.accepted"), eq("evt_accepted_001"), any())).thenReturn(false);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.RUNNING));

        DiscoveryCallbackAckResponse response = discoveryCallbackService.handleAccepted(
                discoveryId,
                new DiscoveryAcceptedCommand(WORKER_ID, acceptedAt, "browser-1"),
                headers("evt_accepted_001")
        );

        assertThat(response.duplicate()).isTrue();
        assertThat(response.status()).isEqualTo(DiscoveryStatus.RUNNING);
        verify(siteDiscoveryMapper, never()).markRunning(discoveryId, acceptedAt);
    }

    @Test
    void duplicateCheckpointCallbackDoesNotPersistAgain() {
        UUID discoveryId = UUID.randomUUID();
        SaveRunCheckpointsCommand command = new SaveRunCheckpointsCommand(List.of(new SaveRunCheckpointCommand(
                "cp_001",
                "discovery",
                "FIRST_VIEW",
                Map.of("source", "discovery"),
                Map.of("durationMs", 10, "status", "settled"),
                10,
                Map.of("url", "https://example.com"),
                List.of(Map.of("type", "cta_candidate")),
                List.of(),
                List.of()
        )));
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.checkpoints"), eq("evt_checkpoint_001"), any())).thenReturn(false);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.RUNNING));

        DiscoveryCallbackAckResponse response = discoveryCallbackService.handleCheckpoints(
                discoveryId,
                WORKER_ID,
                command,
                headers("evt_checkpoint_001")
        );

        assertThat(response.duplicate()).isTrue();
        assertThat(response.checkpointCount()).isEqualTo(1);
        verify(checkpointPersistenceService, never()).saveDiscoveryCheckpoints(discoveryId, command);
    }

    @Test
    void duplicateFinishedCallbackDoesNotCompleteDiscoveryAgain() {
        UUID discoveryId = UUID.randomUUID();
        OffsetDateTime finishedAt = OffsetDateTime.parse("2026-04-21T10:05:00+09:00");
        DiscoverySummaryCommand summary = new DiscoverySummaryCommand(List.of(), List.of(), 0, 0, 0, 0, List.of());
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.finished"), eq("evt_finished_001"), any())).thenReturn(false);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.COMPLETED));

        DiscoveryCallbackAckResponse response = discoveryCallbackService.handleFinished(
                discoveryId,
                new DiscoveryFinishedCommand(WORKER_ID, finishedAt, "https://example.com", summary),
                headers("evt_finished_001")
        );

        assertThat(response.duplicate()).isTrue();
        assertThat(response.status()).isEqualTo(DiscoveryStatus.COMPLETED);
        verify(siteDiscoveryMapper, never()).markCompleted(discoveryId, "https://example.com", "{}", finishedAt);
        verify(scenarioRecommendationMapper, never()).deleteByDiscoveryId(discoveryId);
    }

    @Test
    void duplicateFailedCallbackDoesNotFailDiscoveryAgain() {
        UUID discoveryId = UUID.randomUUID();
        OffsetDateTime failedAt = OffsetDateTime.parse("2026-04-21T10:05:00+09:00");
        when(processedMessagePersistenceAdapter.tryMarkProcessed(eq("runner.discovery.failed"), eq("evt_failed_001"), any())).thenReturn(false);
        when(discoveryService.findDiscovery(discoveryId)).thenReturn(discovery(discoveryId, DiscoveryStatus.FAILED));

        DiscoveryCallbackAckResponse response = discoveryCallbackService.handleFailed(
                discoveryId,
                new DiscoveryFailedCommand(WORKER_ID, failedAt, "DISCOVERY_TIMEOUT", "Discovery timed out"),
                headers("evt_failed_001")
        );

        assertThat(response.duplicate()).isTrue();
        assertThat(response.status()).isEqualTo(DiscoveryStatus.FAILED);
        verify(siteDiscoveryMapper, never()).markFailed(discoveryId, "DISCOVERY_TIMEOUT", "Discovery timed out", failedAt);
    }

    private SiteDiscovery discovery(UUID discoveryId, DiscoveryStatus status) {
        SiteDiscovery discovery = new SiteDiscovery();
        discovery.setId(discoveryId);
        discovery.setStatus(status);
        return discovery;
    }

    private InternalCallbackContext headers(String eventId) {
        return new InternalCallbackContext(WORKER_ID, eventId, SIGNATURE);
    }
}
