package com.wedge.discovery.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
import com.wedge.discovery.application.command.DiscoverySummaryCommand;
import com.wedge.discovery.domain.DiscoveryStatus;
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
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.accepted", "evt_accepted_001")).thenReturn(true);
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
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.accepted", "evt_accepted_001")).thenReturn(true);
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
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.checkpoints", "evt_checkpoint_001")).thenReturn(true);
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
    void duplicateAcceptedCallbackDoesNotTransitionDiscoveryAgain() {
        UUID discoveryId = UUID.randomUUID();
        OffsetDateTime acceptedAt = OffsetDateTime.parse("2026-04-21T10:00:00+09:00");
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.accepted", "evt_accepted_001")).thenReturn(false);
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
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.checkpoints", "evt_checkpoint_001")).thenReturn(false);
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
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.finished", "evt_finished_001")).thenReturn(false);
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
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.discovery.failed", "evt_failed_001")).thenReturn(false);
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
