package com.wedge.analysis.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.analysis.api.dto.AnalysisRequestResponse;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.RunMapper;
import java.net.URI;
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
class AnalysisRequestServiceTest {
    @Mock
    private RunService runService;

    @Mock
    private EvidenceService evidenceService;

    @Mock
    private AnalysisJobMapper analysisJobMapper;

    @Mock
    private RunMapper runMapper;

    @Mock
    private AnalysisRequestPublisher analysisRequestPublisher;

    @Captor
    private ArgumentCaptor<AnalysisJob> analysisJobCaptor;

    @Captor
    private ArgumentCaptor<AnalysisRequestMessage> messageCaptor;

    private AnalysisRequestService analysisRequestService;

    @BeforeEach
    void setUp() {
        analysisRequestService = new AnalysisRequestService(
                runService,
                evidenceService,
                analysisJobMapper,
                runMapper,
                analysisRequestPublisher
        );
    }

    @Test
    void requestPrimaryAnalysisPublishesFullEvidencePacketMessage() {
        UUID runId = UUID.randomUUID();
        Map<String, Object> evidencePacket = Map.of(
                "schema_version", "0.5",
                "run_id", runId.toString(),
                "checkpoints", List.of(Map.of("checkpoint_id", "cp_001")),
                "artifacts", List.of(Map.of("artifact_id", "artifact_001"))
        );
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.COMPLETED));
        when(evidenceService.getRunEvidencePacket(runId)).thenReturn(evidencePacket);

        AnalysisRequestResponse response = analysisRequestService.requestPrimaryAnalysis(runId);

        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.status()).isEqualTo(AnalysisJobStatus.QUEUED.name());
        assertThat(response.analysisType()).isEqualTo("PRIMARY");
        assertThat(response.evidencePacketIncluded()).isTrue();
        assertThat(response.checkpointCount()).isEqualTo(1);
        assertThat(response.artifactCount()).isEqualTo(1);

        verify(analysisJobMapper).insertQueued(analysisJobCaptor.capture());
        AnalysisJob queuedJob = analysisJobCaptor.getValue();
        assertThat(queuedJob.getId()).isEqualTo(response.analysisJobId());
        assertThat(queuedJob.getRunId()).isEqualTo(runId);
        assertThat(queuedJob.getJobType()).isEqualTo("PRIMARY");
        assertThat(queuedJob.getStatus()).isEqualTo(AnalysisJobStatus.QUEUED);

        verify(runMapper).updateAnalysisState(runId, AnalysisStatus.QUEUED, response.analysisJobId(), null, null);
        verify(analysisRequestPublisher).publish(messageCaptor.capture());
        AnalysisRequestMessage message = messageCaptor.getValue();
        assertThat(message.messageType()).isEqualTo("analysis.request");
        assertThat(message.schemaVersion()).isEqualTo("0.5");
        assertThat(message.producer()).isEqualTo("spring-api");
        assertThat(message.payload())
                .containsEntry("analysisJobId", response.analysisJobId().toString())
                .containsEntry("runId", runId.toString())
                .containsEntry("analysisType", "PRIMARY")
                .containsEntry("evidencePacket", evidencePacket);
        assertThat(message.payload()).doesNotContainKey("evidencePacketId");
    }

    @Test
    void requestPrimaryAnalysisRejectsRunBeforeCompletion() {
        UUID runId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.RUNNING));

        assertThatThrownBy(() -> analysisRequestService.requestPrimaryAnalysis(runId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.STATE_CONFLICT);

        verify(evidenceService, never()).getRunEvidencePacket(runId);
        verify(analysisJobMapper, never()).insertQueued(any());
        verify(analysisRequestPublisher, never()).publish(any());
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
