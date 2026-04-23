package com.wedge.run.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RunPersistenceAdapterTest {
    @Mock
    private RunMapper runMapper;

    @InjectMocks
    private RunPersistenceAdapter runPersistenceAdapter;

    @Captor
    private ArgumentCaptor<RunRecord> runRecordCaptor;

    @Test
    void createRunBuildsDefaultPersistenceRecord() {
        RunCreateRequest request = sampleRequest();

        RunResponse created = runPersistenceAdapter.createRun(request);

        verify(runMapper).insert(runRecordCaptor.capture());
        RunRecord persisted = runRecordCaptor.getValue();
        assertThat(persisted.getProjectId()).isEqualTo(request.projectId());
        assertThat(persisted.getTriggerSource()).isEqualTo("WEB");
        assertThat(persisted.getEnvironmentJson()).isEqualTo("{}");
        assertThat(persisted.getScenarioPlanJson()).isEqualTo("{}");
        assertThat(persisted.getStatus()).isEqualTo(RunStatus.CREATED);
        assertThat(persisted.getResultCompleteness()).isEqualTo(ResultCompleteness.NONE);
        assertThat(persisted.getAnalysisStatus()).isEqualTo(AnalysisStatus.NOT_STARTED);

        assertThat(created.id()).isEqualTo(persisted.getId());
        assertThat(created.projectId()).isEqualTo(request.projectId());
        assertThat(created.status()).isEqualTo(RunStatus.CREATED);
        assertThat(created.startUrl()).isEqualTo(request.startUrl());
    }

    @Test
    void listRunsMapsStoredRowsToApiResponses() {
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
        RunRecord stored = sampleRecord();
        when(runMapper.findById(stored.getId())).thenReturn(Optional.of(stored));

        Optional<RunResponse> run = runPersistenceAdapter.findRun(stored.getId());

        assertThat(run).isPresent();
        assertThat(run.orElseThrow().startUrl()).isEqualTo(URI.create(stored.getStartUrl()));
        assertThat(run.orElseThrow().analysisStatus()).isEqualTo(stored.getAnalysisStatus());
    }

    @Test
    void updateExecutionStateReturnsUpdatedApiShape() {
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
}
