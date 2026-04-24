package com.wedge.internal.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.internal.runner.dto.RunnerAcceptedRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import com.wedge.internal.runner.dto.RunnerCallbackHeaders;
import com.wedge.internal.runner.dto.RunnerFailedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedRequest;
import com.wedge.internal.runner.dto.RunnerFinishedSummary;
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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RunnerCallbackServiceTest {
    @Mock
    private RunService runService;

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    @InjectMocks
    private RunnerCallbackService runnerCallbackService;

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
