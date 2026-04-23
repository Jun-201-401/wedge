package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RunServiceTest {
    @Mock
    private RunPersistenceAdapter runPersistenceAdapter;

    @Mock
    private RunRequestPublisher runRequestPublisher;

    @Mock
    private RunExecuteRequestMessageFactory runExecuteRequestMessageFactory;

    @InjectMocks
    private RunService runService;

    @Test
    void createdRunCanBeRetrievedAndStarted() {
        RunCreateRequest request = sampleRequest();
        RunResponse created = sampleRun(RunStatus.CREATED, ResultCompleteness.NONE);
        RunResponse queued = sampleRun(created.id(), RunStatus.QUEUED, ResultCompleteness.NONE);
        RunExecuteRequestMessage message = sampleMessage(created.id());

        when(runPersistenceAdapter.createRun(request)).thenReturn(created);
        when(runPersistenceAdapter.findRun(created.id())).thenReturn(Optional.of(created));
        when(runPersistenceAdapter.updateExecutionState(created, RunStatus.QUEUED, ResultCompleteness.NONE)).thenReturn(queued);
        when(runExecuteRequestMessageFactory.create(queued)).thenReturn(message);

        RunResponse persisted = runService.createRun(request);
        assertThat(persisted.status()).isEqualTo(RunStatus.CREATED);
        assertThat(runService.getRun(created.id()).status()).isEqualTo(RunStatus.CREATED);

        RunResponse started = runService.startRun(created.id());

        assertThat(started.status()).isEqualTo(RunStatus.QUEUED);
        assertThat(started.resultCompleteness()).isEqualTo(ResultCompleteness.NONE);
        verify(runRequestPublisher).publish(message);
    }

    @Test
    void missingRunRaisesNotFoundBusinessException() {
        UUID missingRunId = UUID.randomUUID();
        when(runPersistenceAdapter.findRun(missingRunId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> runService.getRun(missingRunId))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Run was not found.");
    }

    @Test
    void invalidTransitionRaisesStateConflict() {
        RunResponse created = sampleRun(RunStatus.CREATED, ResultCompleteness.NONE);
        when(runPersistenceAdapter.findRun(created.id())).thenReturn(Optional.of(created));

        assertThatThrownBy(() -> runService.finishRun(created.id(), false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("CREATED -> COMPLETED");
    }

    @Test
    void deletingUnknownRunRaisesNotFoundBusinessException() {
        UUID missingRunId = UUID.randomUUID();
        when(runPersistenceAdapter.softDeleteRun(missingRunId)).thenReturn(false);

        assertThatThrownBy(() -> runService.deleteRun(missingRunId))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Run was not found.");
    }

    @Test
    void markRunningLeavesNonStartingRunUntouched() {
        RunResponse queued = sampleRun(RunStatus.QUEUED, ResultCompleteness.NONE);
        when(runPersistenceAdapter.findRun(queued.id())).thenReturn(Optional.of(queued));

        RunResponse result = runService.markRunningIfStarting(queued.id());

        assertThat(result.status()).isEqualTo(RunStatus.QUEUED);
        verify(runPersistenceAdapter).findRun(queued.id());
    }

    @Test
    void startRunPropagatesPublisherFailure() {
        RunResponse created = sampleRun(RunStatus.CREATED, ResultCompleteness.NONE);
        RunResponse queued = sampleRun(created.id(), RunStatus.QUEUED, ResultCompleteness.NONE);
        RunExecuteRequestMessage message = sampleMessage(created.id());

        when(runPersistenceAdapter.findRun(created.id())).thenReturn(Optional.of(created));
        when(runPersistenceAdapter.updateExecutionState(created, RunStatus.QUEUED, ResultCompleteness.NONE)).thenReturn(queued);
        when(runExecuteRequestMessageFactory.create(queued)).thenReturn(message);
        doThrow(new IllegalStateException("mq unavailable")).when(runRequestPublisher).publish(message);

        assertThatThrownBy(() -> runService.startRun(created.id()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mq unavailable");
    }

    private RunCreateRequest sampleRequest() {
        return new RunCreateRequest(
                UUID.randomUUID(),
                "Landing CTA audit",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                null
        );
    }

    private RunResponse sampleRun(RunStatus status, ResultCompleteness resultCompleteness) {
        return sampleRun(UUID.randomUUID(), status, resultCompleteness);
    }

    private RunResponse sampleRun(UUID id, RunStatus status, ResultCompleteness resultCompleteness) {
        return new RunResponse(
                id,
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
                com.wedge.run.domain.AnalysisStatus.NOT_STARTED,
                null,
                status == RunStatus.STARTING || status == RunStatus.RUNNING
                        ? OffsetDateTime.parse("2026-04-21T10:00:00+09:00")
                        : null,
                null,
                null,
                null,
                null
        );
    }

    private RunExecuteRequestMessage sampleMessage(UUID runId) {
        return new RunExecuteRequestMessage(
                UUID.randomUUID().toString(),
                "run.execute.request",
                "0.5",
                "2026-04-23T00:00:00Z",
                "spring-api",
                runId.toString(),
                "run:" + runId,
                Map.of("runId", runId.toString())
        );
    }
}
