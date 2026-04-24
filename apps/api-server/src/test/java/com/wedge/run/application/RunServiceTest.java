package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.OutboxMessagePersistenceAdapter;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

@ExtendWith(MockitoExtension.class)
class RunServiceTest {
    @Mock
    private RunPersistenceAdapter runPersistenceAdapter;

    @Mock
    private RunExecuteRequestMessageFactory runExecuteRequestMessageFactory;

    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    @InjectMocks
    private RunService runService;

    @Test
    void createdRunCanBeRetrievedAndStarted() {
        RunCreateRequest request = sampleRequest();
        RunResponse created = sampleRun(RunStatus.CREATED, ResultCompleteness.NONE);
        RunResponse queued = sampleRun(created.id(), RunStatus.QUEUED, ResultCompleteness.NONE);
        RunExecuteRequestMessage message = sampleMessage(created.id());
        UUID outboxMessageId = UUID.randomUUID();
        RunExecutionRequestSource executionRequestSource = sampleExecutionRequestSource(created.id());

        when(runPersistenceAdapter.createRun(request)).thenReturn(created);
        when(runPersistenceAdapter.findRun(created.id())).thenReturn(Optional.of(created));
        when(runPersistenceAdapter.findExecutionRequestSource(created.id())).thenReturn(Optional.of(executionRequestSource));
        when(runPersistenceAdapter.updateExecutionState(created, RunStatus.QUEUED, ResultCompleteness.NONE)).thenReturn(queued);
        when(runExecuteRequestMessageFactory.create(executionRequestSource)).thenReturn(message);
        when(outboxMessagePersistenceAdapter.appendRunExecuteMessage(message)).thenReturn(outboxMessageId);

        RunResponse persisted = runService.createRun(request);
        assertThat(persisted.status()).isEqualTo(RunStatus.CREATED);
        assertThat(runService.getRun(created.id()).status()).isEqualTo(RunStatus.CREATED);

        RunResponse started = runService.startRun(created.id());

        assertThat(started.status()).isEqualTo(RunStatus.QUEUED);
        assertThat(started.resultCompleteness()).isEqualTo(ResultCompleteness.NONE);
        verify(outboxMessagePersistenceAdapter).appendRunExecuteMessage(message);
        ArgumentCaptor<RunExecuteOutboxEnqueuedEvent> eventCaptor = ArgumentCaptor.forClass(RunExecuteOutboxEnqueuedEvent.class);
        verify(applicationEventPublisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue().outboxMessageId()).isEqualTo(outboxMessageId);
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
    void startRunFailsWhenMaterializedScenarioPlanIsMissing() {
        RunResponse created = sampleRun(RunStatus.CREATED, ResultCompleteness.NONE);
        RunExecutionRequestSource executionRequestSource = new RunExecutionRequestSource(
                created.id(),
                created.projectId(),
                created.triggerSource(),
                created.startUrl(),
                created.goal(),
                created.devicePreset(),
                created.scenarioTemplateVersionId(),
                Map.of()
        );

        when(runPersistenceAdapter.findRun(created.id())).thenReturn(Optional.of(created));
        when(runPersistenceAdapter.findExecutionRequestSource(created.id())).thenReturn(Optional.of(executionRequestSource));
        when(runPersistenceAdapter.updateExecutionState(created, RunStatus.QUEUED, ResultCompleteness.NONE))
                .thenReturn(sampleRun(created.id(), RunStatus.QUEUED, ResultCompleteness.NONE));
        when(runExecuteRequestMessageFactory.create(executionRequestSource))
                .thenThrow(new IllegalStateException("Cannot publish run.execute.request without a materialized scenarioPlan"));

        assertThatThrownBy(() -> runService.startRun(created.id()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("materialized scenarioPlan");
        verify(outboxMessagePersistenceAdapter, never()).appendRunExecuteMessage(any());
    }

    @Test
    void createRunRejectsMissingScenarioPlan() {
        RunCreateRequest request = new RunCreateRequest(
                UUID.randomUUID(),
                "Landing CTA audit",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                null,
                Map.of()
        );

        assertThatThrownBy(() -> runService.createRun(request))
                .isInstanceOf(BusinessException.class)
                .hasMessage("scenarioPlan is required.");
    }

    @Test
    void createRunRejectsScenarioPlanWithMismatchedStartUrl() {
        RunCreateRequest request = new RunCreateRequest(
                UUID.randomUUID(),
                "Landing CTA audit",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                null,
                Map.of(
                        "schema_version", "0.5",
                        "plan_id", "plan_001",
                        "scenario_type", "custom_compiled",
                        "start_url", "https://other.example.com",
                        "environment", Map.of("device", "desktop"),
                        "steps", List.of(Map.of("step_id", "step_001"))
                )
        );

        assertThatThrownBy(() -> runService.createRun(request))
                .isInstanceOf(BusinessException.class)
                .hasMessage("scenarioPlan.start_url must match startUrl.");
    }

    @Test
    void createRunRejectsScenarioPlanWithMismatchedDevicePreset() {
        RunCreateRequest request = new RunCreateRequest(
                UUID.randomUUID(),
                "Landing CTA audit",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                null,
                Map.of(
                        "schema_version", "0.5",
                        "plan_id", "plan_001",
                        "scenario_type", "custom_compiled",
                        "start_url", "https://example.com",
                        "environment", Map.of("device", "mobile"),
                        "steps", List.of(Map.of("step_id", "step_001"))
                )
        );

        assertThatThrownBy(() -> runService.createRun(request))
                .isInstanceOf(BusinessException.class)
                .hasMessage("scenarioPlan.environment.device must match devicePreset.");
    }

    private RunCreateRequest sampleRequest() {
        return new RunCreateRequest(
                UUID.randomUUID(),
                "Landing CTA audit",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                null,
                Map.of(
                        "schema_version", "0.5",
                        "plan_id", "plan_001",
                        "scenario_type", "custom_compiled",
                        "goal", "무료 체험 CTA까지의 흐름 점검",
                        "start_url", "https://example.com",
                        "environment", Map.of(
                                "device", "desktop",
                                "viewport", Map.of("width", 1440, "height", 900),
                                "locale", "ko-KR",
                                "timezone", "Asia/Seoul",
                                "permissions", List.of(),
                                "auth_state", "anonymous"
                        ),
                        "safety", Map.of(
                                "allow_external_navigation", false,
                                "allow_payment_commit", false,
                                "allow_destructive_action", false,
                                "use_synthetic_inputs", true,
                                "stop_before_real_payment", true
                        ),
                        "steps", List.of(
                                Map.of(
                                        "step_id", "step_001_goto",
                                        "stage", "FIRST_VIEW",
                                        "description", "랜딩 첫 화면 로드",
                                        "action", Map.of("type", "goto", "target", Map.of("url", "https://example.com")),
                                        "settle_strategy", Map.of("type", "network_idle", "timeout_ms", 10000),
                                        "checkpoint", true
                                )
                        )
                )
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

    private RunExecutionRequestSource sampleExecutionRequestSource(UUID runId) {
        return new RunExecutionRequestSource(
                runId,
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                Map.of(
                        "schema_version", "0.5",
                        "plan_id", "plan_" + runId,
                        "scenario_type", "custom_compiled",
                        "goal", "무료 체험 CTA까지의 흐름 점검",
                        "start_url", "https://example.com",
                        "environment", Map.of(
                                "device", "desktop",
                                "viewport", Map.of("width", 1440, "height", 900),
                                "locale", "ko-KR",
                                "timezone", "Asia/Seoul",
                                "permissions", List.of(),
                                "auth_state", "anonymous"
                        ),
                        "safety", Map.of(
                                "allow_external_navigation", false,
                                "allow_payment_commit", false,
                                "allow_destructive_action", false,
                                "use_synthetic_inputs", true,
                                "stop_before_real_payment", true
                        ),
                        "steps", List.of(
                                Map.of(
                                        "step_id", "step_001_goto",
                                        "stage", "FIRST_VIEW",
                                        "description", "랜딩 첫 화면 로드",
                                        "action", Map.of("type", "goto", "target", Map.of("url", "https://example.com")),
                                        "settle_strategy", Map.of("type", "network_idle", "timeout_ms", 10000),
                                        "checkpoint", true
                                )
                        )
                )
        );
    }
}
