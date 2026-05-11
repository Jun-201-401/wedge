package com.wedge.run.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunEventResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunExecutionRequestSource;
import com.wedge.run.application.command.RunnerAgentEventCommand;
import com.wedge.run.application.command.RunnerAgentTraceCommand;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RunPersistenceAdapterTest {
    @Mock
    private RunMapper runMapper;
    @Captor
    private ArgumentCaptor<RunRecord> runRecordCaptor;
    @Captor
    private ArgumentCaptor<RunStepRecord> runStepRecordCaptor;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void createRunBuildsDefaultPersistenceRecord() {
        RunPersistenceAdapter runPersistenceAdapter = adapter();
        RunCreateRequest request = sampleRequest();

        RunResponse created = runPersistenceAdapter.createRun(request);

        verify(runMapper).insert(runRecordCaptor.capture());
        RunRecord persisted = runRecordCaptor.getValue();
        assertThat(persisted.getProjectId()).isEqualTo(request.projectId());
        assertThat(persisted.getTriggerSource()).isEqualTo("WEB");
        assertThat(persisted.getEnvironmentJson()).isEqualTo("{}");
        assertThat(persisted.getScenarioPlanSchemaVersion()).isEqualTo("0.5");
        assertThat(persisted.getScenarioPlanJson()).contains("\"plan_id\":\"plan_001\"");
        assertThat(persisted.getStatus()).isEqualTo(RunStatus.CREATED);
        assertThat(persisted.getResultCompleteness()).isEqualTo(ResultCompleteness.NONE);
        assertThat(persisted.getAnalysisStatus()).isEqualTo(AnalysisStatus.NOT_STARTED);
        verify(runMapper, times(2)).insertStep(runStepRecordCaptor.capture());
        List<RunStepRecord> persistedSteps = runStepRecordCaptor.getAllValues();
        assertThat(persistedSteps)
                .extracting(RunStepRecord::getStepOrder, RunStepRecord::getStepKey, RunStepRecord::getStepName, RunStepRecord::getStage, RunStepRecord::getStepType, RunStepRecord::getStatus)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1, "step_001_goto", "랜딩 첫 화면 로드", "FIRST_VIEW", "GOTO", StepStatus.PENDING),
                        org.assertj.core.groups.Tuple.tuple(2, "step_002_click_signup", "CTA 클릭", "CTA", "CLICK", StepStatus.PENDING)
                );
        assertThat(persistedSteps).allSatisfy(step -> assertThat(step.getRunId()).isEqualTo(persisted.getId()));

        assertThat(created.id()).isEqualTo(persisted.getId());
        assertThat(created.projectId()).isEqualTo(request.projectId());
        assertThat(created.status()).isEqualTo(RunStatus.CREATED);
        assertThat(created.startUrl()).isEqualTo(request.startUrl());
    }

    @Test
    void listRunsMapsStoredRowsToApiResponses() {
        RunPersistenceAdapter runPersistenceAdapter = adapter();
        RunRecord stored = sampleRecord();
        when(runMapper.findAll(stored.getProjectId(), RunStatus.RUNNING)).thenReturn(List.of(stored));

        List<RunResponse> runs = runPersistenceAdapter.listRuns(stored.getProjectId(), RunStatus.RUNNING);

        assertThat(runs).hasSize(1);
        assertThat(runs.get(0).id()).isEqualTo(stored.getId());
        assertThat(runs.get(0).status()).isEqualTo(RunStatus.RUNNING);
        assertThat(runs.get(0).failureCode()).isEqualTo("RUNNER_TIMEOUT");
    }

    @Test
    void findRunReturnsMappedRunWhenPresent() {
        RunPersistenceAdapter runPersistenceAdapter = adapter();
        RunRecord stored = sampleRecord();
        when(runMapper.findById(stored.getId())).thenReturn(Optional.of(stored));

        Optional<RunResponse> run = runPersistenceAdapter.findRun(stored.getId());

        assertThat(run).isPresent();
        assertThat(run.orElseThrow().startUrl()).isEqualTo(URI.create(stored.getStartUrl()));
        assertThat(run.orElseThrow().analysisStatus()).isEqualTo(stored.getAnalysisStatus());
    }

    @Test
    void listRunStepsMapsStoredStepRowsToApiResponses() {
        UUID runId = UUID.randomUUID();
        RunStepRecord failedStep = sampleStepRecord(runId, 2, "step_002_submit", StepStatus.FAILED);
        failedStep.setErrorCode("RUNNER_TIMEOUT");
        failedStep.setErrorMessage("locator click timed out");
        when(runMapper.findStepsByRunId(runId)).thenReturn(List.of(failedStep));

        List<com.wedge.run.api.dto.RunStepResponse> steps = adapter().listRunSteps(runId);

        assertThat(steps).hasSize(1);
        assertThat(steps.get(0).id()).isEqualTo(failedStep.getId());
        assertThat(steps.get(0).runId()).isEqualTo(runId);
        assertThat(steps.get(0).stepOrder()).isEqualTo(2);
        assertThat(steps.get(0).stepKey()).isEqualTo("step_002_submit");
        assertThat(steps.get(0).status()).isEqualTo(StepStatus.FAILED);
        assertThat(steps.get(0).errorCode()).isEqualTo("RUNNER_TIMEOUT");
        assertThat(steps.get(0).errorMessage()).isEqualTo("locator click timed out");
    }

    @Test
    void findRunStepMapsStoredStepRowWhenItBelongsToRun() {
        UUID runId = UUID.randomUUID();
        RunStepRecord step = sampleStepRecord(runId, 1, "step_001_goto", StepStatus.PASSED);
        when(runMapper.findStepByRunIdAndId(runId, step.getId())).thenReturn(Optional.of(step));

        Optional<com.wedge.run.api.dto.RunStepResponse> response = adapter().findRunStep(runId, step.getId());

        assertThat(response).isPresent();
        assertThat(response.orElseThrow().stepKey()).isEqualTo("step_001_goto");
        assertThat(response.orElseThrow().status()).isEqualTo(StepStatus.PASSED);
    }

    @Test
    void listRunEventsMapsStoredEventRowsToApiResponses() {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        RunEventRecord event = new RunEventRecord();
        event.setId(UUID.randomUUID());
        event.setRunId(runId);
        event.setStepId(stepId);
        event.setStepKey("step_002_submit");
        event.setEventType("STEP_FAILED");
        event.setSource("RUNNER");
        event.setPayloadJson("{\"message\":\"locator click timed out\",\"failureCode\":\"RUNNER_TIMEOUT\"}");
        event.setOccurredAt(OffsetDateTime.parse("2026-04-28T10:00:03+09:00"));
        UUID cursorEventId = UUID.randomUUID();
        when(runMapper.findEvents(runId, stepId, "STEP_FAILED", cursorEventId, 21)).thenReturn(List.of(event));

        List<RunEventResponse> events = adapter().listRunEvents(runId, stepId, "STEP_FAILED", cursorEventId, 21);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).id()).isEqualTo(event.getId());
        assertThat(events.get(0).runId()).isEqualTo(runId);
        assertThat(events.get(0).stepId()).isEqualTo(stepId);
        assertThat(events.get(0).stepKey()).isEqualTo("step_002_submit");
        assertThat(events.get(0).eventType()).isEqualTo("STEP_FAILED");
        assertThat(events.get(0).eventSource()).isEqualTo("RUNNER");
        assertThat(events.get(0).payload())
                .containsEntry("message", "locator click timed out")
                .containsEntry("failureCode", "RUNNER_TIMEOUT");
        assertThat(events.get(0).occurredAt()).isEqualTo(event.getOccurredAt());
        verify(runMapper).findEvents(runId, stepId, "STEP_FAILED", cursorEventId, 21);
    }

    @Test
    void findExecutionRequestSourceParsesStoredScenarioPlanJson() {
        RunPersistenceAdapter runPersistenceAdapter = adapter();
        RunRecord stored = sampleRecord();
        stored.setScenarioPlanJson("{\"schema_version\":\"0.5\",\"plan_id\":\"plan_001\"}");
        when(runMapper.findById(stored.getId())).thenReturn(Optional.of(stored));

        RunExecutionRequestSource source = runPersistenceAdapter.findExecutionRequestSource(stored.getId()).orElseThrow();

        assertThat(source.scenarioPlan()).containsEntry("schema_version", "0.5");
        assertThat(source.scenarioPlan()).containsEntry("plan_id", "plan_001");
    }

    @Test
    void updateExecutionStateReturnsUpdatedApiShape() {
        RunPersistenceAdapter runPersistenceAdapter = adapter();
        RunResponse current = sampleResponse(RunStatus.CREATED, ResultCompleteness.NONE);
        when(runMapper.updateExecutionState(
                current.id(),
                RunStatus.CREATED,
                RunStatus.QUEUED,
                ResultCompleteness.NONE,
                null,
                null
        )).thenReturn(1);

        RunResponse updated = runPersistenceAdapter.updateExecutionState(current, RunStatus.QUEUED, ResultCompleteness.NONE);

        assertThat(updated.status()).isEqualTo(RunStatus.QUEUED);
        assertThat(updated.resultCompleteness()).isEqualTo(ResultCompleteness.NONE);
    }

    @Test
    void updateFailureStateRaisesConflictWhenConcurrentUpdateFails() {
        RunPersistenceAdapter runPersistenceAdapter = adapter();
        RunResponse current = sampleResponse(RunStatus.RUNNING, ResultCompleteness.PARTIAL);
        when(runMapper.updateFailureState(
                org.mockito.ArgumentMatchers.eq(current.id()),
                org.mockito.ArgumentMatchers.eq(RunStatus.RUNNING),
                org.mockito.ArgumentMatchers.eq(ResultCompleteness.PARTIAL),
                any(),
                org.mockito.ArgumentMatchers.eq("RUNNER_TIMEOUT"),
                org.mockito.ArgumentMatchers.eq("Runner callback timed out")
        )).thenReturn(0);

        assertThatThrownBy(() -> runPersistenceAdapter.updateFailureState(
                current,
                "RUNNER_TIMEOUT",
                "Runner callback timed out",
                ResultCompleteness.PARTIAL
        ))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("RUNNING -> FAILED");
    }

    @Test
    void resolveStepMapsStoredStepRow() {
        UUID runId = UUID.randomUUID();
        RunStepRecord stepRecord = new RunStepRecord();
        stepRecord.setId(UUID.randomUUID());
        stepRecord.setRunId(runId);
        stepRecord.setStepOrder(3);
        stepRecord.setStepKey("step_003_fill_email");
        stepRecord.setStatus(StepStatus.PENDING);
        when(runMapper.findStepByRunIdAndStepKey(runId, "step_003_fill_email")).thenReturn(Optional.of(stepRecord));

        RunPersistenceAdapter adapter = new RunPersistenceAdapter(runMapper, objectMapper);
        RunPersistenceAdapter.ResolvedStep resolved = adapter.resolveStep(runId, "step_003_fill_email");

        assertThat(resolved.id()).isEqualTo(stepRecord.getId());
        assertThat(resolved.stepOrder()).isEqualTo(3);
        assertThat(resolved.stepKey()).isEqualTo("step_003_fill_email");
    }

    @Test
    void saveAgentEventsPersistsEachAgentEvent() {
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        OffsetDateTime occurredAt = OffsetDateTime.parse("2026-05-06T10:00:00+09:00");
        when(runMapper.insertAgentEvent(any(), eq(runId), eq(taskId), eq(attemptId), eq("agent-event-1"), eq(2),
                eq("AGENT_STOPPED"), any(), eq(occurredAt))).thenReturn(1);

        int inserted = adapter().saveAgentEvents(runId, List.of(new RunnerAgentEventCommand(
                "0.1",
                "agent-event-1",
                taskId,
                attemptId,
                runId,
                2,
                "AGENT_STOPPED",
                occurredAt,
                Map.of("final_outcome", "SUCCESS_CHECKOUT_ENTRY_REACHED")
        )));

        assertThat(inserted).isEqualTo(1);
        verify(runMapper).insertAgentEvent(any(), eq(runId), eq(taskId), eq(attemptId), eq("agent-event-1"), eq(2),
                eq("AGENT_STOPPED"), org.mockito.ArgumentMatchers.contains("SUCCESS_CHECKOUT_ENTRY_REACHED"), eq(occurredAt));
    }

    @Test
    void saveAgentTracePersistsTraceSnapshotWithIndexedFields() {
        UUID runId = UUID.randomUUID();
        UUID traceId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        OffsetDateTime startedAt = OffsetDateTime.parse("2026-05-06T10:00:00+09:00");
        OffsetDateTime finishedAt = OffsetDateTime.parse("2026-05-06T10:00:05+09:00");
        when(runMapper.insertAgentTrace(any(), eq(runId), eq(traceId), eq(taskId), eq(attemptId),
                eq("SUCCESS_CHECKOUT_ENTRY_REACHED"), any(), eq(startedAt), eq(finishedAt))).thenReturn(1);

        int inserted = adapter().saveAgentTrace(runId, new RunnerAgentTraceCommand(Map.of(
                "trace_id", traceId.toString(),
                "task_id", taskId.toString(),
                "attempt_id", attemptId.toString(),
                "run_id", runId.toString(),
                "started_at", startedAt.toString(),
                "finished_at", finishedAt.toString(),
                "final_outcome", "SUCCESS_CHECKOUT_ENTRY_REACHED"
        )));

        assertThat(inserted).isEqualTo(1);
        verify(runMapper).insertAgentTrace(any(), eq(runId), eq(traceId), eq(taskId), eq(attemptId),
                eq("SUCCESS_CHECKOUT_ENTRY_REACHED"), org.mockito.ArgumentMatchers.contains(traceId.toString()), eq(startedAt), eq(finishedAt));
    }

    private RunPersistenceAdapter adapter() {
        return new RunPersistenceAdapter(runMapper, objectMapper);
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
                        "steps", List.of(
                                Map.of(
                                        "step_id", "step_001_goto",
                                        "stage", "FIRST_VIEW",
                                        "description", "랜딩 첫 화면 로드",
                                        "action", Map.of("type", "goto")
                                ),
                                Map.of(
                                        "step_id", "step_002_click_signup",
                                        "stage", "CTA",
                                        "description", "CTA 클릭",
                                        "action", Map.of("type", "click")
                                )
                        )
                )
        );
    }

    private RunRecord sampleRecord() {
        RunRecord record = new RunRecord();
        record.setId(UUID.randomUUID());
        record.setProjectId(UUID.randomUUID());
        record.setName("Landing CTA audit");
        record.setTriggerSource("WEB");
        record.setStartUrl("https://example.com");
        record.setGoal("무료 체험 CTA까지의 흐름 점검");
        record.setDevicePreset("desktop");
        record.setScenarioTemplateVersionId(UUID.randomUUID());
        record.setStatus(RunStatus.RUNNING);
        record.setResultCompleteness(ResultCompleteness.PARTIAL);
        record.setAnalysisStatus(AnalysisStatus.RUNNING);
        record.setCurrentStepOrder(2);
        record.setStartedAt(OffsetDateTime.parse("2026-04-21T10:00:00+09:00"));
        record.setFinishedAt(OffsetDateTime.parse("2026-04-21T10:05:00+09:00"));
        record.setFailureCode("RUNNER_TIMEOUT");
        record.setFailureMessage("Runner callback timed out");
        record.setScenarioPlanJson("{}");
        return record;
    }

    private RunResponse sampleResponse(RunStatus status, ResultCompleteness resultCompleteness) {
        return new RunResponse(
                UUID.randomUUID(),
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

    private RunStepRecord sampleStepRecord(UUID runId, int stepOrder, String stepKey, StepStatus status) {
        RunStepRecord record = new RunStepRecord();
        record.setId(UUID.randomUUID());
        record.setRunId(runId);
        record.setStepOrder(stepOrder);
        record.setStepKey(stepKey);
        record.setStepName(stepKey + " name");
        record.setStage("CTA");
        record.setStepType(stepKey.contains("goto") ? "GOTO" : "CLICK");
        record.setStatus(status);
        record.setStartedAt(OffsetDateTime.parse("2026-04-21T10:00:00+09:00"));
        record.setFinishedAt(status == StepStatus.PENDING ? null : OffsetDateTime.parse("2026-04-21T10:00:03+09:00"));
        return record;
    }
}
