package com.wedge.internal.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
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
import com.wedge.run.domain.StepStatus;
import com.wedge.run.infrastructure.RunMapper;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.net.URI;
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
class RunnerCallbackServiceTest {
    private static final String WORKER_ID = "runner_001";
    private static final String SIGNATURE = "hmac-sha256=sig";

    @Mock
    private RunService runService;

    @Mock
    private RunPersistenceAdapter runPersistenceAdapter;

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    @Mock
    private ArtifactPersistenceService artifactPersistenceService;

    @Mock
    private CheckpointPersistenceService checkpointPersistenceService;

    @Mock
    private RunMapper runMapper;

    private RunnerCallbackService runnerCallbackService;

    @BeforeEach
    void setUp() {
        runnerCallbackService = new RunnerCallbackService(
                runService,
                runPersistenceAdapter,
                processedMessagePersistenceAdapter,
                artifactPersistenceService,
                checkpointPersistenceService,
                runMapper
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
                new RunnerAcceptedRequest(WORKER_ID, OffsetDateTime.parse("2026-04-21T10:00:00+09:00"), "browser-1"),
                headers("evt_accepted_001")
        );

        assertThat(result.get("runId")).isEqualTo(runId);
        assertThat(result.get("status")).isEqualTo(RunStatus.STARTING);
        verify(runService).markAccepted(runId);
    }

    @Test
    void stepEventsCallbackPromotesRunToRunningAndCountsEvents() {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        OffsetDateTime occurredAt = OffsetDateTime.parse("2026-04-21T10:01:00+09:00");
        RunResponse running = sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.step-events", "evt_step_batch_001")).thenReturn(true);
        when(runService.markRunningIfStarting(runId)).thenReturn(running);
        when(runPersistenceAdapter.resolveStep(runId, "step_001_goto"))
                .thenReturn(new RunPersistenceAdapter.ResolvedStep(stepId, 1, "step_001_goto", StepStatus.PENDING));

        RunnerStepEventsRequest request = new RunnerStepEventsRequest(List.of(
                new RunnerStepEvent(
                        UUID.randomUUID(),
                        1,
                        "step_001_goto",
                        RunnerStepEventType.STEP_STARTED,
                        occurredAt,
                        Map.of("message", "started")
                )
        ));

        Map<String, Object> result = runnerCallbackService.handleStepEvents(
                runId,
                request,
                headers("evt_step_batch_001")
        );

        assertThat(result.get("status")).isEqualTo(RunStatus.RUNNING);
        assertThat(result.get("eventCount")).isEqualTo(1);
        verify(runPersistenceAdapter).updateCurrentStepOrder(runId, 1);
        verify(runPersistenceAdapter).appendRunEvent(runId, stepId, "STEP_STARTED", Map.of("message", "started"), occurredAt);
        verify(runPersistenceAdapter).updateStepState(stepId, StepStatus.RUNNING, occurredAt);
    }

    @Test
    void stepEventsCallbackDoesNotMutateStepsAfterRunIsTerminal() {
        UUID runId = UUID.randomUUID();
        RunResponse completed = sampleRun(runId, RunStatus.COMPLETED, ResultCompleteness.FINAL);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.step-events", "evt_late_step_001")).thenReturn(true);
        when(runService.markRunningIfStarting(runId)).thenReturn(completed);

        RunnerStepEventsRequest request = new RunnerStepEventsRequest(List.of(
                new RunnerStepEvent(
                        UUID.randomUUID(),
                        3,
                        "step_003_done",
                        RunnerStepEventType.STEP_COMPLETED,
                        OffsetDateTime.parse("2026-04-21T10:06:00+09:00"),
                        Map.of("message", "late")
                )
        ));

        Map<String, Object> result = runnerCallbackService.handleStepEvents(
                runId,
                request,
                headers("evt_late_step_001")
        );

        assertThat(result.get("status")).isEqualTo(RunStatus.COMPLETED);
        assertThat(result.get("eventCount")).isEqualTo(1);
        verifyNoInteractions(runPersistenceAdapter);
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
                headers("evt_failed_001")
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
                        WORKER_ID,
                        OffsetDateTime.parse("2026-04-21T10:05:00+09:00"),
                        new RunnerFinishedSummary(5, 0, false)
                ),
                headers("evt_finished_001")
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
                new RunnerCallbackHeaders(WORKER_ID, "", SIGNATURE)
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Runner callback headers are required.");
    }

    @Test
    void checkpointAndArtifactCallbacksResolveStepBeforeDelegatingPersistence() {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.checkpoints", "evt_checkpoint_001")).thenReturn(true);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.artifacts", "evt_artifact_001")).thenReturn(true);
        when(runPersistenceAdapter.resolveStep(runId, "step_002_click_signup"))
                .thenReturn(new RunPersistenceAdapter.ResolvedStep(stepId, 2, "step_002_click_signup", StepStatus.RUNNING));
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE));

        RunnerCheckpointsRequest checkpointsRequest = new RunnerCheckpointsRequest(List.of(
                new RunnerCheckpointRequest(
                        "cp_001",
                        "step_002_click_signup",
                        RunnerCheckpointStage.CTA,
                        Map.of("type", "click"),
                        new RunnerSettleInfo("locator_visible", 1200, RunnerSettleStatus.settled),
                        Map.of("page", Map.of("url", "https://example.com/signup")),
                        List.of(),
                        List.of(),
                        List.of("artifact:screenshot_cp_001")
                )
        ));

        RunnerArtifactsRequest artifactsRequest = new RunnerArtifactsRequest(List.of(
                new RunnerArtifactRequest(
                        artifactId,
                        "step_002_click_signup",
                        RunnerArtifactType.SCREENSHOT,
                        "bucket-a",
                        "runs/a/shot.png",
                        "image/png",
                        1440,
                        900,
                        42L,
                        "abc123",
                        OffsetDateTime.parse("2026-04-21T10:02:00+09:00")
                )
        ));

        runnerCallbackService.handleCheckpoints(runId, checkpointsRequest, headers("evt_checkpoint_001"));
        runnerCallbackService.handleArtifacts(runId, artifactsRequest, headers("evt_artifact_001"));

        verify(runPersistenceAdapter, times(2)).updateCurrentStepOrder(runId, 2);
        verify(checkpointPersistenceService).saveRunCheckpoints(
                eq(runId),
                any(SaveRunCheckpointsCommand.class),
                eq(Map.of("step_002_click_signup", stepId))
        );
        verify(artifactPersistenceService).saveRunArtifacts(
                eq(runId),
                any(SaveRunArtifactsCommand.class),
                eq(Map.of("step_002_click_signup", stepId))
        );
        verify(runMapper).updateLatestArtifact(runId, artifactId);
    }

    @Test
    void duplicateAcceptedCallbackDoesNotTransitionRunAgain() {
        UUID runId = UUID.randomUUID();
        RunResponse current = sampleRun(runId, RunStatus.STARTING, ResultCompleteness.NONE);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.accepted", "evt_accepted_001")).thenReturn(false);
        when(runService.getRun(runId)).thenReturn(current);

        Map<String, Object> result = runnerCallbackService.handleAccepted(
                runId,
                new RunnerAcceptedRequest(WORKER_ID, OffsetDateTime.parse("2026-04-21T10:00:00+09:00"), "browser-1"),
                headers("evt_accepted_001")
        );

        assertThat(result.get("status")).isEqualTo(RunStatus.STARTING);
        assertThat(result.get("duplicate")).isEqualTo(true);
        verify(runService, never()).markAccepted(runId);
    }

    @Test
    void duplicateCheckpointCallbackDoesNotPersistAgain() {
        UUID runId = UUID.randomUUID();
        RunnerCheckpointsRequest request = sampleCheckpointRequest();
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.checkpoints", "evt_checkpoint_001")).thenReturn(false);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE));

        Map<String, Object> result = runnerCallbackService.handleCheckpoints(
                runId,
                request,
                headers("evt_checkpoint_001")
        );

        assertThat(result.get("checkpointCount")).isEqualTo(1);
        assertThat(result.get("duplicate")).isEqualTo(true);
        verifyNoInteractions(checkpointPersistenceService);
    }

    @Test
    void duplicateArtifactCallbackDoesNotPersistAgain() {
        UUID runId = UUID.randomUUID();
        RunnerArtifactsRequest request = sampleArtifactRequest();
        when(processedMessagePersistenceAdapter.tryMarkProcessed("runner.artifacts", "evt_artifact_001")).thenReturn(false);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId, RunStatus.RUNNING, ResultCompleteness.NONE));

        Map<String, Object> result = runnerCallbackService.handleArtifacts(
                runId,
                request,
                headers("evt_artifact_001")
        );

        assertThat(result.get("artifactCount")).isEqualTo(1);
        assertThat(result.get("duplicate")).isEqualTo(true);
        verifyNoInteractions(artifactPersistenceService);
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

    private RunnerCallbackHeaders headers(String eventId) {
        return new RunnerCallbackHeaders(WORKER_ID, eventId, SIGNATURE);
    }

    private RunnerArtifactsRequest sampleArtifactRequest() {
        return new RunnerArtifactsRequest(List.of(new RunnerArtifactRequest(
                UUID.randomUUID(),
                "step_001_click_cta",
                RunnerArtifactType.SCREENSHOT,
                "wedge-artifacts",
                "run-1/step_001_click_cta/screenshot.png",
                "image/png",
                1440,
                900,
                1024,
                "7c6a180b36896a0a8c02787eeafb0e4c2d7ea40a6abdd2a7636f3f4c1c4a7b1f",
                OffsetDateTime.parse("2026-04-27T10:15:00+09:00")
        )));
    }

    private RunnerCheckpointsRequest sampleCheckpointRequest() {
        return new RunnerCheckpointsRequest(List.of(new RunnerCheckpointRequest(
                "checkpoint-response-1",
                "step_003_fill_email",
                RunnerCheckpointStage.INPUT,
                Map.of("stepOrder", 3),
                new RunnerSettleInfo("response", 216, RunnerSettleStatus.settled),
                Map.of("url", "https://example.com/signup"),
                List.of(Map.of("type", "form_field")),
                List.of(),
                List.of("artifact-response-screenshot")
        )));
    }
}
