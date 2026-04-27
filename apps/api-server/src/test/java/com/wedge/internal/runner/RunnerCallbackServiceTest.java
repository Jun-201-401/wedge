package com.wedge.internal.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactRequest;
import com.wedge.internal.runner.dto.RunnerArtifactType;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerCheckpointRequest;
import com.wedge.internal.runner.dto.RunnerCheckpointStage;
import com.wedge.internal.runner.dto.RunnerCheckpointsRequest;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedSummary;
import com.wedge.internal.runner.dto.RunnerSettleInfo;
import com.wedge.internal.runner.dto.RunnerSettleStatus;
import com.wedge.internal.runner.dto.RunnerStepEvent;
import com.wedge.internal.runner.dto.RunnerStepEventType;
import com.wedge.internal.runner.dto.RunnerStepEventsRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
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
import com.wedge.run.infrastructure.RunMapper;

@ExtendWith(MockitoExtension.class)
class RunnerCallbackServiceTest {
    @Mock
    private RunService runService;

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    @Mock
    private ArtifactMapper artifactMapper;

    @Mock
    private CheckpointMapper checkpointMapper;

    @Mock
    private ObservationMapper observationMapper;

    @Mock
    private RunMapper runMapper;

    private RunnerCallbackService runnerCallbackService;

    @BeforeEach
    void setUp() {
        runnerCallbackService = new RunnerCallbackService(
                runService,
                processedMessagePersistenceAdapter,
                artifactMapper,
                checkpointMapper,
                observationMapper,
                runMapper,
                new ObjectMapper()
        );
    }

    @Test
    void acceptedCallbackTransitionsRunToStarting() {
        UUID runId = UUID.randomUUID();
        RunResponse starting = sampleRun(runId, RunStatus.STARTING, ResultCompleteness.NONE);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.accepted", "evt_accepted_001")).thenReturn(true);
        when(runService.markAccepted(runId)).thenReturn(starting);

        Map<String, Object> result = runnerCallbackService.handleAccepted(
                runId,
                new RunnerAcceptedRequest("runner_001", OffsetDateTime.parse("2026-04-21T10:00:00+09:00"), "browser-1"),
                new RunnerCallbackHeaders("runner_001", "evt_accepted_001", "hmac-sha256=sig")
        );

        assertThat(result.get("runId")).isEqualTo(runId);
        assertThat(result.get("status")).isEqualTo(RunStatus.STARTING);
        verify(runService).markAccepted(runId);
    }

    @Test
    void stepEventsCallbackPromotesRunToRunningAndCountsEvents() {
        UUID runId = UUID.randomUUID();
        RunResponse running = sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.step-events", "evt_step_batch_001")).thenReturn(true);
        when(runService.markRunningIfStarting(runId)).thenReturn(running);

        RunnerStepEventsRequest request = new RunnerStepEventsRequest(List.of(
                new RunnerStepEvent(
                        UUID.randomUUID(),
                        1,
                        "step_001_goto",
                        RunnerStepEventType.STEP_STARTED,
                        OffsetDateTime.parse("2026-04-21T10:01:00+09:00"),
                        Map.of("message", "started")
                )
        ));

        Map<String, Object> result = runnerCallbackService.handleStepEvents(
                runId,
                request,
                new RunnerCallbackHeaders("runner_001", "evt_step_batch_001", "hmac-sha256=sig")
        );

        assertThat(result.get("status")).isEqualTo(RunStatus.RUNNING);
        assertThat(result.get("eventCount")).isEqualTo(1);
    }

    @Test
    void failedCallbackValidatesMatchingWorkerId() {
        UUID runId = UUID.randomUUID();

        assertThatThrownBy(() -> runnerCallbackService.handleFailed(
                runId,
                new RunnerFailedRequest(
                        "runner_002",
                        OffsetDateTime.parse("2026-04-21T10:03:00+09:00"),
                        "RUNNER_TIMEOUT",
                        "Runner callback timed out",
                        ResultCompleteness.PARTIAL
                ),
                new RunnerCallbackHeaders("runner_001", "evt_failed_001", "hmac-sha256=sig")
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Runner worker id header does not match payload.");
    }

    @Test
    void finishedCallbackReturnsResultCompleteness() {
        UUID runId = UUID.randomUUID();
        RunResponse completed = sampleRun(runId, RunStatus.COMPLETED, ResultCompleteness.FINAL);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.finished", "evt_finished_001")).thenReturn(true);
        when(runService.finishRun(runId, false)).thenReturn(completed);

        Map<String, Object> result = runnerCallbackService.handleFinished(
                runId,
                new RunnerFinishedRequest(
                        "runner_001",
                        OffsetDateTime.parse("2026-04-21T10:05:00+09:00"),
                        new RunnerFinishedSummary(5, 0, false)
                ),
                new RunnerCallbackHeaders("runner_001", "evt_finished_001", "hmac-sha256=sig")
        );

        assertThat(result.get("status")).isEqualTo(RunStatus.COMPLETED);
        assertThat(result.get("resultCompleteness")).isEqualTo(ResultCompleteness.FINAL);
    }

    @Test
    void artifactCallbackRequiresNonBlankHeaders() {
        UUID runId = UUID.randomUUID();

        assertThatThrownBy(() -> runnerCallbackService.handleArtifacts(
                runId,
                new RunnerArtifactsRequest(List.of()),
                new RunnerCallbackHeaders("runner_001", "", "hmac-sha256=sig")
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Runner callback headers are required.");
    }

    @Test
    void artifactCallbackPersistsArtifactMetadataAndUpdatesLatestArtifact() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.artifacts", "evt_artifacts_001")).thenReturn(true);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE));

        runnerCallbackService.handleArtifacts(
                runId,
                new RunnerArtifactsRequest(List.of(new RunnerArtifactRequest(
                        artifactId,
                        "step_001_goto",
                        RunnerArtifactType.SCREENSHOT,
                        "local-runner",
                        runId + "/step_001_goto/" + artifactId + "-screenshot.png",
                        "image/png",
                        1440,
                        900,
                        1234,
                        "sha256",
                        OffsetDateTime.parse("2026-04-21T10:02:00+09:00")
                ))),
                new RunnerCallbackHeaders("runner_001", "evt_artifacts_001", "hmac-sha256=sig")
        );

        ArgumentCaptor<Artifact> artifactCaptor = ArgumentCaptor.forClass(Artifact.class);
        verify(artifactMapper).insert(artifactCaptor.capture());
        Artifact artifact = artifactCaptor.getValue();
        assertThat(artifact.getId()).isEqualTo(artifactId);
        assertThat(artifact.getRunId()).isEqualTo(runId);
        assertThat(artifact.getArtifactType()).isEqualTo(ArtifactType.SCREENSHOT);
        assertThat(artifact.getS3Key()).contains("step_001_goto");
        verify(runMapper).updateLatestArtifact(runId, artifactId);
    }

    @Test
    void checkpointCallbackPersistsCheckpointAndNormalizedObservations() {
        UUID runId = UUID.randomUUID();
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.checkpoints", "evt_checkpoints_001")).thenReturn(true);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE));

        runnerCallbackService.handleCheckpoints(
                runId,
                new RunnerCheckpointsRequest(List.of(new RunnerCheckpointRequest(
                        "cp_001",
                        "step_001_goto",
                        RunnerCheckpointStage.FIRST_VIEW,
                        Map.of("actionType", "goto"),
                        new RunnerSettleInfo("network_idle", 1200, RunnerSettleStatus.settled),
                        Map.of("url", "https://example.com"),
                        List.of(Map.of(
                                "type", "cta_candidate",
                                "target", "text=Start free",
                                "confidence", 0.86
                        )),
                        List.of(Map.of("type", "last_action", "action", "goto")),
                        List.of("artifact:" + UUID.randomUUID())
                ))),
                new RunnerCallbackHeaders("runner_001", "evt_checkpoints_001", "hmac-sha256=sig")
        );

        ArgumentCaptor<Checkpoint> checkpointCaptor = ArgumentCaptor.forClass(Checkpoint.class);
        verify(checkpointMapper).insert(checkpointCaptor.capture());
        Checkpoint checkpoint = checkpointCaptor.getValue();
        assertThat(checkpoint.getRunId()).isEqualTo(runId);
        assertThat(checkpoint.getCheckpointKey()).isEqualTo("cp_001");
        assertThat(checkpoint.getStage()).isEqualTo("FIRST_VIEW");
        assertThat(checkpoint.getSettleJsonb()).contains("network_idle");
        verify(runMapper).updateLatestCheckpoint(runId, checkpoint.getId());

        ArgumentCaptor<Observation> observationCaptor = ArgumentCaptor.forClass(Observation.class);
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
    void duplicateAcceptedCallbackDoesNotTransitionRunAgain() {
        UUID runId = UUID.randomUUID();
        RunResponse current = sampleRun(runId, RunStatus.STARTING, ResultCompleteness.NONE);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.accepted", "evt_accepted_001")).thenReturn(false);
        when(runService.getRun(runId)).thenReturn(current);

        Map<String, Object> result = runnerCallbackService.handleAccepted(
                runId,
                new RunnerAcceptedRequest("runner_001", OffsetDateTime.parse("2026-04-21T10:00:00+09:00"), "browser-1"),
                new RunnerCallbackHeaders("runner_001", "evt_accepted_001", "hmac-sha256=sig")
        );

        assertThat(result.get("status")).isEqualTo(RunStatus.STARTING);
        assertThat(result.get("duplicate")).isEqualTo(true);
        verify(runService, never()).markAccepted(runId);
    }

    private RunResponse sampleRun(UUID runId, RunStatus status, ResultCompleteness resultCompleteness) {
        return new RunResponse(
                runId,
                "run",
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                status,
                resultCompleteness,
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
