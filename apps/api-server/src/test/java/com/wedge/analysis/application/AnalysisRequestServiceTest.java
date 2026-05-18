package com.wedge.analysis.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.analysis.api.dto.AnalysisRequestResponse;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.evidence.domain.EvidencePacketSnapshot;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import com.wedge.run.infrastructure.RunMapper;
import java.net.URI;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.mock.env.MockEnvironment;

@ExtendWith(MockitoExtension.class)
class AnalysisRequestServiceTest {
    @Mock
    private RunService runService;

    @Mock
    private ProjectAccessService projectAccessService;

    @Mock
    private EvidenceService evidenceService;

    @Mock
    private AnalysisJobMapper analysisJobMapper;

    @Mock
    private RunMapper runMapper;

    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    @Captor
    private ArgumentCaptor<AnalysisJob> analysisJobCaptor;

    @Captor
    private ArgumentCaptor<AnalysisRequestMessage> messageCaptor;

    @Captor
    private ArgumentCaptor<AnalysisRequestOutboxEnqueuedEvent> eventCaptor;

    private AnalysisRequestService analysisRequestService;

    @BeforeEach
    void setUp() {
        analysisRequestService = analysisRequestService(true);
    }

    @Test
    void requestPrimaryAnalysisPublishesEvidencePacketIdMessage() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID evidencePacketId = UUID.randomUUID();
        RunResponse run = sampleRun(runId, RunStatus.COMPLETED);
        EvidencePacketSnapshot evidencePacket = snapshot(evidencePacketId, runId, 1, 1);
        when(runService.getRun(runId)).thenReturn(run);
        when(evidenceService.materializeRunEvidencePacketSnapshot(runId)).thenReturn(evidencePacket);
        UUID outboxMessageId = UUID.randomUUID();
        when(outboxMessagePersistenceAdapter.appendAnalysisRequestMessage(any(AnalysisRequestMessage.class), any(UUID.class)))
                .thenReturn(outboxMessageId);

        AnalysisRequestResponse response = analysisRequestService.requestPrimaryAnalysis(runId, userId);

        verify(projectAccessService).ensureProjectAccessible(run.projectId(), userId);
        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.status()).isEqualTo(AnalysisJobStatus.QUEUED.name());
        assertThat(response.analysisType()).isEqualTo("PRIMARY");
        assertThat(response.evidencePacketId()).isEqualTo(evidencePacketId);
        assertThat(response.evidencePacketIncluded()).isFalse();
        assertThat(response.checkpointCount()).isEqualTo(1);
        assertThat(response.artifactCount()).isEqualTo(1);

        verify(analysisJobMapper).insertQueued(analysisJobCaptor.capture());
        AnalysisJob queuedJob = analysisJobCaptor.getValue();
        assertThat(queuedJob.getId()).isEqualTo(response.analysisJobId());
        assertThat(queuedJob.getRunId()).isEqualTo(runId);
        assertThat(queuedJob.getJobType()).isEqualTo("PRIMARY");
        assertThat(queuedJob.getStatus()).isEqualTo(AnalysisJobStatus.QUEUED);
        assertThat(queuedJob.getEvidencePacketId()).isEqualTo(evidencePacketId);

        verify(runMapper).markAnalysisQueued(runId, response.analysisJobId());
        verify(outboxMessagePersistenceAdapter).appendAnalysisRequestMessage(messageCaptor.capture(), org.mockito.Mockito.eq(response.analysisJobId()));
        AnalysisRequestMessage message = messageCaptor.getValue();
        assertThat(message.messageType()).isEqualTo("analysis.request");
        assertThat(message.schemaVersion()).isEqualTo("0.5");
        assertThat(message.producer()).isEqualTo("spring-api");
        assertThat(message.payload())
                .containsEntry("analysisJobId", response.analysisJobId().toString())
                .containsEntry("runId", runId.toString())
                .containsEntry("analysisType", "PRIMARY")
                .containsEntry("evidencePacketId", evidencePacketId.toString());
        assertThat(message.payload()).doesNotContainKey("evidencePacket");
        verify(applicationEventPublisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue().outboxMessageId()).isEqualTo(outboxMessageId);
    }

    @Test
    void requestPrimaryAnalysisUsesExactMaterializedEvidencePacketIdForEachRequest() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID firstEvidencePacketId = UUID.randomUUID();
        UUID secondEvidencePacketId = UUID.randomUUID();
        RunResponse run = sampleRun(runId, RunStatus.COMPLETED);
        when(runService.getRun(runId)).thenReturn(run);
        when(evidenceService.materializeRunEvidencePacketSnapshot(runId)).thenReturn(
                snapshot(firstEvidencePacketId, runId, 1, 1),
                snapshot(secondEvidencePacketId, runId, 2, 2)
        );
        when(outboxMessagePersistenceAdapter.appendAnalysisRequestMessage(any(AnalysisRequestMessage.class), any(UUID.class)))
                .thenReturn(UUID.randomUUID(), UUID.randomUUID());

        AnalysisRequestResponse first = analysisRequestService.requestPrimaryAnalysis(runId, userId);
        AnalysisRequestResponse second = analysisRequestService.requestPrimaryAnalysis(runId, userId);

        assertThat(first.evidencePacketId()).isEqualTo(firstEvidencePacketId);
        assertThat(second.evidencePacketId()).isEqualTo(secondEvidencePacketId);
        assertThat(second.checkpointCount()).isEqualTo(2);
        assertThat(second.artifactCount()).isEqualTo(2);

        verify(analysisJobMapper, times(2)).insertQueued(analysisJobCaptor.capture());
        assertThat(analysisJobCaptor.getAllValues())
                .extracting(AnalysisJob::getEvidencePacketId)
                .containsExactly(firstEvidencePacketId, secondEvidencePacketId);

        verify(outboxMessagePersistenceAdapter, times(2))
                .appendAnalysisRequestMessage(messageCaptor.capture(), any(UUID.class));
        assertThat(messageCaptor.getAllValues())
                .extracting(message -> message.payload().get("evidencePacketId"))
                .containsExactly(firstEvidencePacketId.toString(), secondEvidencePacketId.toString());
    }

    @Test
    void requestPrimaryAnalysisCanSkipProjectAccessForMvpMode() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID evidencePacketId = UUID.randomUUID();
        RunResponse run = sampleRun(runId, RunStatus.COMPLETED);
        EvidencePacketSnapshot evidencePacket = snapshot(evidencePacketId, runId, 1, 1);
        analysisRequestService = analysisRequestService(false, "dev");
        when(runService.getRun(runId)).thenReturn(run);
        when(evidenceService.materializeRunEvidencePacketSnapshot(runId)).thenReturn(evidencePacket);
        UUID outboxMessageId = UUID.randomUUID();
        when(outboxMessagePersistenceAdapter.appendAnalysisRequestMessage(any(AnalysisRequestMessage.class), any(UUID.class)))
                .thenReturn(outboxMessageId);

        AnalysisRequestResponse response = analysisRequestService.requestPrimaryAnalysis(runId, userId);

        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.status()).isEqualTo(AnalysisJobStatus.QUEUED.name());
        verify(projectAccessService, never()).ensureProjectAccessible(run.projectId(), userId);
        verify(analysisJobMapper).insertQueued(any(AnalysisJob.class));
        verify(runMapper).markAnalysisQueued(runId, response.analysisJobId());
        verify(applicationEventPublisher).publishEvent(any(AnalysisRequestOutboxEnqueuedEvent.class));
    }

    @Test
    void requestPrimaryAnalysisDoesNotSkipProjectAccessOutsideDevProfile() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RunResponse run = sampleRun(runId, RunStatus.COMPLETED);
        analysisRequestService = analysisRequestService(false, "prod");
        when(runService.getRun(runId)).thenReturn(run);

        org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.FORBIDDEN))
                .when(projectAccessService)
                .ensureProjectAccessible(run.projectId(), userId);

        assertThatThrownBy(() -> analysisRequestService.requestPrimaryAnalysis(runId, userId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FORBIDDEN);

        verify(evidenceService, never()).materializeRunEvidencePacketSnapshot(runId);
    }

    @Test
    void requestPrimaryAnalysisRejectsRunBeforeCompletion() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RunResponse run = sampleRun(runId, RunStatus.RUNNING);
        when(runService.getRun(runId)).thenReturn(run);

        assertThatThrownBy(() -> analysisRequestService.requestPrimaryAnalysis(runId, userId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.STATE_CONFLICT);

        verify(projectAccessService).ensureProjectAccessible(run.projectId(), userId);
        verify(evidenceService, never()).materializeRunEvidencePacketSnapshot(runId);
        verify(analysisJobMapper, never()).insertQueued(any());
        verify(outboxMessagePersistenceAdapter, never()).appendAnalysisRequestMessage(any(), any());
        verify(applicationEventPublisher, never()).publishEvent(any());
    }

    @Test
    void requestPrimaryAnalysisRejectsInaccessibleProjectBeforePublishing() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RunResponse run = sampleRun(runId, RunStatus.COMPLETED);
        when(runService.getRun(runId)).thenReturn(run);
        org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.FORBIDDEN))
                .when(projectAccessService)
                .ensureProjectAccessible(run.projectId(), userId);

        assertThatThrownBy(() -> analysisRequestService.requestPrimaryAnalysis(runId, userId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FORBIDDEN);

        verify(evidenceService, never()).materializeRunEvidencePacketSnapshot(runId);
        verify(analysisJobMapper, never()).insertQueued(any());
        verify(outboxMessagePersistenceAdapter, never()).appendAnalysisRequestMessage(any(), any());
        verify(applicationEventPublisher, never()).publishEvent(any());
    }

    @Test
    void markRequestFailedIfAwaitingAnalyzerFailsQueuedAnalysisJobAndRunState() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AnalysisJob queued = analysisJob(analysisJobId, runId, AnalysisJobStatus.QUEUED);
        AnalysisJob failed = analysisJob(analysisJobId, runId, AnalysisJobStatus.FAILED);
        when(analysisJobMapper.findById(analysisJobId)).thenReturn(Optional.of(queued), Optional.of(failed));
        when(analysisJobMapper.markFailed(any(AnalysisJob.class))).thenReturn(1);

        Optional<AnalysisJob> result = analysisRequestService.markRequestFailedIfAwaitingAnalyzer(
                analysisJobId,
                runId,
                "ANALYSIS_REQUEST_DEAD_LETTERED",
                "Analysis request could not be delivered to Analyzer."
        );

        assertThat(result).contains(failed);
        verify(analysisJobMapper).markFailed(analysisJobCaptor.capture());
        AnalysisJob captured = analysisJobCaptor.getValue();
        assertThat(captured.getId()).isEqualTo(analysisJobId);
        assertThat(captured.getRunId()).isEqualTo(runId);
        assertThat(captured.getStatus()).isEqualTo(AnalysisJobStatus.FAILED);
        assertThat(captured.getErrorCode()).isEqualTo("ANALYSIS_REQUEST_DEAD_LETTERED");
        assertThat(captured.getErrorMessage()).isEqualTo("Analysis request could not be delivered to Analyzer.");
        verify(runMapper).updateCurrentAnalysisState(runId, AnalysisStatus.FAILED, analysisJobId, null, null);
    }

    @Test
    void markRequestFailedIfAwaitingAnalyzerDoesNotOverrideRunningAnalysisJob() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(analysisJobMapper.findById(analysisJobId))
                .thenReturn(Optional.of(analysisJob(analysisJobId, runId, AnalysisJobStatus.RUNNING)));

        Optional<AnalysisJob> result = analysisRequestService.markRequestFailedIfAwaitingAnalyzer(
                analysisJobId,
                runId,
                "ANALYSIS_REQUEST_DEAD_LETTERED",
                "Analysis request could not be delivered to Analyzer."
        );

        assertThat(result).isEmpty();
        verify(analysisJobMapper, never()).markFailed(any());
        verify(runMapper, never()).updateCurrentAnalysisState(any(), any(), any(), any(), any());
    }

    private EvidencePacketSnapshot snapshot(UUID evidencePacketId, UUID runId, int checkpointCount, int artifactCount) {
        EvidencePacketSnapshot snapshot = new EvidencePacketSnapshot();
        snapshot.setId(evidencePacketId);
        snapshot.setExecutionType("RUN");
        snapshot.setRunId(runId);
        snapshot.setSchemaVersion("0.5");
        snapshot.setCheckpointCount(checkpointCount);
        snapshot.setArtifactCount(artifactCount);
        return snapshot;
    }

    private AnalysisRequestService analysisRequestService(boolean accessCheckEnabled, String... activeProfiles) {
        AnalysisProperties properties = new AnalysisProperties();
        properties.setProjectAccessCheckEnabled(accessCheckEnabled);
        return new AnalysisRequestService(
                runService,
                new AnalysisAccessGuard(projectAccessService, properties, environment(activeProfiles)),
                evidenceService,
                analysisJobMapper,
                runMapper,
                outboxMessagePersistenceAdapter,
                applicationEventPublisher
        );
    }

    private MockEnvironment environment(String... activeProfiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(activeProfiles);
        return environment;
    }

    private AnalysisJob analysisJob(UUID analysisJobId, UUID runId, AnalysisJobStatus status) {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(analysisJobId);
        analysisJob.setRunId(runId);
        analysisJob.setJobType("PRIMARY");
        analysisJob.setStatus(status);
        return analysisJob;
    }

    private RunResponse sampleRun(UUID runId, RunStatus status) {
        return new RunResponse(
                runId,
                "run",
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "첫 화면 CTA 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                status,
                status == RunStatus.COMPLETED ? ResultCompleteness.FINAL : ResultCompleteness.NONE,
                AnalysisStatus.NOT_STARTED,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
