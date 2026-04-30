package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.command.RunnerAcceptedCommand;
import com.wedge.run.application.command.RunnerCallbackContext;
import com.wedge.run.application.command.RunnerFailedCommand;
import com.wedge.run.application.command.RunnerFinishedCommand;
import com.wedge.run.application.command.RunnerStepEventCommand;
import com.wedge.run.application.command.RunnerStepEventsCommand;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import java.math.BigDecimal;
import com.wedge.run.infrastructure.OutboxMessagePersistenceAdapter;
import com.wedge.run.infrastructure.RunMapper;
import com.wedge.run.infrastructure.RunPersistenceAdapter;
import com.wedge.run.infrastructure.RunRecord;
import com.wedge.run.infrastructure.RunStepRecord;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

@ExtendWith(MockitoExtension.class)
class RunnerCallbackLifecycleScenarioTest {
    private static final String WORKER_ID = "runner_001";
    private static final String SIGNATURE = "hmac-sha256=sig";

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    @Mock
    private ArtifactPersistenceService artifactPersistenceService;

    @Mock
    private CheckpointPersistenceService checkpointPersistenceService;

    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    private InMemoryRunMapper runMapper;
    private RunService runService;
    private RunnerCallbackService runnerCallbackService;

    @BeforeEach
    void setUp() {
        runMapper = new InMemoryRunMapper();
        RunPersistenceAdapter runPersistenceAdapter = new RunPersistenceAdapter(runMapper, new ObjectMapper());
        runService = new RunService(
                runPersistenceAdapter,
                new RunExecuteRequestMessageFactory(),
                outboxMessagePersistenceAdapter,
                applicationEventPublisher,
                new ScenarioPlanValidator()
        );
        runnerCallbackService = new RunnerCallbackService(
                runService,
                runPersistenceAdapter,
                processedMessagePersistenceAdapter,
                artifactPersistenceService,
                checkpointPersistenceService
        );

        when(processedMessagePersistenceAdapter.tryMarkProcessed(anyString(), anyString())).thenReturn(true);
        when(outboxMessagePersistenceAdapter.appendRunExecuteMessage(any(RunExecuteRequestMessage.class)))
                .thenReturn(UUID.randomUUID());
    }

    @Test
    void runnerCallbacksDriveRunAndStepLifecycleToCompleted() {
        RunResponse created = runService.createRun(sampleRequest());
        RunResponse queued = runService.startRun(created.id());

        assertThat(queued.status()).isEqualTo(RunStatus.QUEUED);
        assertThat(runMapper.stepsForRun(created.id()))
                .extracting(RunStepRecord::getStepKey, RunStepRecord::getStatus)
                .containsExactly(
                        tuple("step_001_goto", StepStatus.PENDING),
                        tuple("step_002_click_signup", StepStatus.PENDING)
                );

        RunnerCallbackAckResponse accepted = runnerCallbackService.handleAccepted(
                created.id(),
                new RunnerAcceptedCommand(WORKER_ID, at("2026-04-21T10:00:00+09:00"), "browser-1"),
                context("evt_accepted_001")
        );

        assertThat(accepted.status()).isEqualTo(RunStatus.STARTING);
        assertThat(runService.getRun(created.id()).status()).isEqualTo(RunStatus.STARTING);

        RunnerCallbackAckResponse firstStepEvents = runnerCallbackService.handleStepEvents(
                created.id(),
                new RunnerStepEventsCommand(List.of(
                        stepEvent(1, "step_001_goto", "STEP_STARTED", "2026-04-21T10:01:00+09:00"),
                        stepEvent(1, "step_001_goto", "STEP_COMPLETED", "2026-04-21T10:02:00+09:00")
                )),
                context("evt_step_batch_001")
        );

        assertThat(firstStepEvents.status()).isEqualTo(RunStatus.RUNNING);
        assertThat(firstStepEvents.eventCount()).isEqualTo(2);
        assertThat(runService.getRun(created.id()).status()).isEqualTo(RunStatus.RUNNING);
        assertThat(runService.getRun(created.id()).currentStepOrder()).isEqualTo(1);
        RunStepRecord firstStep = runMapper.step(created.id(), "step_001_goto");
        assertThat(firstStep.getStatus()).isEqualTo(StepStatus.PASSED);
        assertThat(firstStep.getStartedAt()).isNotNull();
        assertThat(firstStep.getFinishedAt()).isNotNull();
        assertThat(runMapper.runEvents)
                .extracting(RunEventRecord::stepId, RunEventRecord::eventType, RunEventRecord::source)
                .containsExactly(
                        tuple(firstStep.getId(), "STEP_STARTED", "RUNNER"),
                        tuple(firstStep.getId(), "STEP_COMPLETED", "RUNNER")
                );
        assertThat(runMapper.runEvents)
                .extracting(RunEventRecord::payloadJson)
                .allSatisfy(payloadJson -> assertThat(payloadJson).contains("message"));

        runnerCallbackService.handleStepEvents(
                created.id(),
                new RunnerStepEventsCommand(List.of(
                        stepEvent(2, "step_002_click_signup", "STEP_STARTED", "2026-04-21T10:03:00+09:00"),
                        stepEvent(2, "step_002_click_signup", "STEP_COMPLETED", "2026-04-21T10:04:00+09:00")
                )),
                context("evt_step_batch_002")
        );

        assertThat(runService.getRun(created.id()).currentStepOrder()).isEqualTo(2);
        RunStepRecord secondStep = runMapper.step(created.id(), "step_002_click_signup");
        assertThat(secondStep.getStatus()).isEqualTo(StepStatus.PASSED);
        assertThat(runMapper.runEvents)
                .extracting(RunEventRecord::stepId, RunEventRecord::eventType, RunEventRecord::source)
                .containsExactly(
                        tuple(firstStep.getId(), "STEP_STARTED", "RUNNER"),
                        tuple(firstStep.getId(), "STEP_COMPLETED", "RUNNER"),
                        tuple(secondStep.getId(), "STEP_STARTED", "RUNNER"),
                        tuple(secondStep.getId(), "STEP_COMPLETED", "RUNNER")
                );

        RunnerCallbackAckResponse finished = runnerCallbackService.handleFinished(
                created.id(),
                new RunnerFinishedCommand(WORKER_ID, at("2026-04-21T10:05:00+09:00"), 2, 0, false),
                context("evt_finished_001")
        );

        RunResponse completed = runService.getRun(created.id());
        assertThat(finished.status()).isEqualTo(RunStatus.COMPLETED);
        assertThat(finished.resultCompleteness()).isEqualTo(ResultCompleteness.FINAL);
        assertThat(completed.status()).isEqualTo(RunStatus.COMPLETED);
        assertThat(completed.resultCompleteness()).isEqualTo(ResultCompleteness.FINAL);
        assertThat(completed.currentStepOrder()).isEqualTo(2);
        assertThat(completed.startedAt()).isNotNull();
        assertThat(completed.finishedAt()).isNotNull();
        assertThat(completed.failureCode()).isNull();
        assertThat(runMapper.runEvents).hasSize(4);
    }

    @Test
    void failedCallbackEndsRunAndLateStepEventsDoNotMutateTerminalRun() {
        RunResponse created = runService.createRun(sampleRequest());
        runService.startRun(created.id());
        runnerCallbackService.handleAccepted(
                created.id(),
                new RunnerAcceptedCommand(WORKER_ID, at("2026-04-21T10:00:00+09:00"), "browser-1"),
                context("evt_accepted_001")
        );
        runnerCallbackService.handleStepEvents(
                created.id(),
                new RunnerStepEventsCommand(List.of(
                        stepEvent(1, "step_001_goto", "STEP_STARTED", "2026-04-21T10:01:00+09:00")
                )),
                context("evt_step_batch_001")
        );

        RunnerCallbackAckResponse failed = runnerCallbackService.handleFailed(
                created.id(),
                new RunnerFailedCommand(
                        WORKER_ID,
                        at("2026-04-21T10:02:00+09:00"),
                        "RUNNER_TIMEOUT",
                        "Runner callback timed out",
                        ResultCompleteness.PARTIAL
                ),
                context("evt_failed_001")
        );

        RunResponse failedRun = runService.getRun(created.id());
        assertThat(failed.status()).isEqualTo(RunStatus.FAILED);
        assertThat(failed.resultCompleteness()).isEqualTo(ResultCompleteness.PARTIAL);
        assertThat(failedRun.status()).isEqualTo(RunStatus.FAILED);
        assertThat(failedRun.resultCompleteness()).isEqualTo(ResultCompleteness.PARTIAL);
        assertThat(failedRun.failureCode()).isEqualTo("RUNNER_TIMEOUT");
        assertThat(failedRun.failureMessage()).isEqualTo("Runner callback timed out");
        assertThat(failedRun.finishedAt()).isNotNull();
        assertThat(runMapper.step(created.id(), "step_001_goto").getStatus()).isEqualTo(StepStatus.RUNNING);

        runnerCallbackService.handleStepEvents(
                created.id(),
                new RunnerStepEventsCommand(List.of(
                        stepEvent(1, "step_001_goto", "STEP_COMPLETED", "2026-04-21T10:03:00+09:00")
                )),
                context("evt_late_step_001")
        );

        assertThat(runService.getRun(created.id()).status()).isEqualTo(RunStatus.FAILED);
        RunStepRecord startedStep = runMapper.step(created.id(), "step_001_goto");
        assertThat(startedStep.getStatus()).isEqualTo(StepStatus.RUNNING);
        assertThat(runMapper.runEvents)
                .extracting(RunEventRecord::stepId, RunEventRecord::eventType, RunEventRecord::source)
                .containsExactly(tuple(startedStep.getId(), "STEP_STARTED", "RUNNER"));
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
                        "start_url", "https://example.com",
                        "environment", Map.of("device", "desktop"),
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

    private RunnerStepEventCommand stepEvent(
            int stepOrder,
            String stepKey,
            String eventType,
            String occurredAt
    ) {
        return new RunnerStepEventCommand(
                UUID.randomUUID(),
                stepOrder,
                stepKey,
                eventType,
                at(occurredAt),
                Map.of("message", eventType.toLowerCase())
        );
    }

    private RunnerCallbackContext context(String eventId) {
        return new RunnerCallbackContext(WORKER_ID, eventId, SIGNATURE);
    }

    private OffsetDateTime at(String value) {
        return OffsetDateTime.parse(value);
    }

    private static class InMemoryRunMapper implements RunMapper {
        private final Map<UUID, RunRecord> runs = new LinkedHashMap<>();
        private final Map<UUID, RunStepRecord> steps = new LinkedHashMap<>();
        private final List<RunEventRecord> runEvents = new ArrayList<>();

        @Override
        public List<RunRecord> findAll(UUID projectId, RunStatus status) {
            return runs.values().stream()
                    .filter(run -> run.getDeletedAt() == null)
                    .filter(run -> projectId == null || projectId.equals(run.getProjectId()))
                    .filter(run -> status == null || status == run.getStatus())
                    .toList();
        }

        @Override
        public Optional<RunRecord> findById(UUID runId) {
            return Optional.ofNullable(runs.get(runId))
                    .filter(run -> run.getDeletedAt() == null);
        }

        @Override
        public Optional<RunStepRecord> findStepByRunIdAndStepKey(UUID runId, String stepKey) {
            return steps.values().stream()
                    .filter(step -> runId.equals(step.getRunId()))
                    .filter(step -> stepKey.equals(step.getStepKey()))
                    .findFirst();
        }

        @Override
        public int insert(RunRecord run) {
            runs.put(run.getId(), run);
            return 1;
        }

        @Override
        public int insertStep(RunStepRecord step) {
            steps.put(step.getId(), step);
            return 1;
        }

        @Override
        public int updateExecutionState(
                UUID runId,
                RunStatus expectedStatus,
                RunStatus nextStatus,
                ResultCompleteness resultCompleteness,
                OffsetDateTime startedAt,
                OffsetDateTime finishedAt
        ) {
            RunRecord run = runs.get(runId);
            if (run == null || run.getDeletedAt() != null || run.getStatus() != expectedStatus) {
                return 0;
            }

            run.setStatus(nextStatus);
            run.setResultCompleteness(resultCompleteness);
            run.setStartedAt(startedAt);
            run.setFinishedAt(finishedAt);
            run.setVersion(run.getVersion() + 1);
            return 1;
        }

        @Override
        public int updateFailureState(
                UUID runId,
                RunStatus expectedStatus,
                ResultCompleteness resultCompleteness,
                OffsetDateTime finishedAt,
                String failureCode,
                String failureMessage
        ) {
            RunRecord run = runs.get(runId);
            if (run == null || run.getDeletedAt() != null || run.getStatus() != expectedStatus) {
                return 0;
            }

            run.setStatus(RunStatus.FAILED);
            run.setResultCompleteness(resultCompleteness);
            run.setFinishedAt(finishedAt);
            run.setFailureCode(failureCode);
            run.setFailureMessage(failureMessage);
            run.setVersion(run.getVersion() + 1);
            return 1;
        }

        @Override
        public int updateCurrentStepOrder(UUID runId, Integer currentStepOrder) {
            RunRecord run = runs.get(runId);
            if (run == null || run.getDeletedAt() != null) {
                return 0;
            }

            int current = run.getCurrentStepOrder() == null ? 0 : run.getCurrentStepOrder();
            run.setCurrentStepOrder(Math.max(current, currentStepOrder));
            run.setVersion(run.getVersion() + 1);
            return 1;
        }

        @Override
        public int updateLatestArtifact(UUID runId, UUID artifactId) {
            return runs.containsKey(runId) ? 1 : 0;
        }

        @Override
        public int updateLatestCheckpoint(UUID runId, UUID checkpointId) {
            return runs.containsKey(runId) ? 1 : 0;
        }

        @Override
        public int updateLatestReport(UUID runId, UUID reportId) {
            return runs.containsKey(runId) ? 1 : 0;
        }

        @Override
        public int markAnalysisQueued(UUID runId, UUID analysisJobId) {
            RunRecord run = runs.get(runId);
            if (run == null || run.getDeletedAt() != null) {
                return 0;
            }
            run.setAnalysisStatus(AnalysisStatus.QUEUED);
            run.setVersion(run.getVersion() + 1);
            return 1;
        }

        @Override
        public int updateCurrentAnalysisState(
                UUID runId,
                AnalysisStatus analysisStatus,
                UUID analysisJobId,
                BigDecimal frictionScore,
                UUID reportId
        ) {
            RunRecord run = runs.get(runId);
            if (run == null || run.getDeletedAt() != null) {
                return 0;
            }
            run.setAnalysisStatus(analysisStatus);
            run.setVersion(run.getVersion() + 1);
            return 1;
        }

        @Override
        public int updateStepState(
                UUID stepId,
                StepStatus nextStatus,
                OffsetDateTime startedAt,
                OffsetDateTime finishedAt,
                String errorCode,
                String errorMessage
        ) {
            RunStepRecord step = steps.get(stepId);
            if (step == null) {
                return 0;
            }

            step.setStatus(nextStatus);
            if (startedAt != null) {
                step.setStartedAt(startedAt);
            }
            if (finishedAt != null) {
                step.setFinishedAt(finishedAt);
            }
            step.setErrorCode(errorCode);
            step.setErrorMessage(errorMessage);
            return 1;
        }

        @Override
        public int insertRunEvent(
                UUID id,
                UUID runId,
                UUID stepId,
                String eventType,
                String source,
                String payloadJson,
                OffsetDateTime occurredAt
        ) {
            runEvents.add(new RunEventRecord(id, runId, stepId, eventType, source, payloadJson, occurredAt));
            return 1;
        }

        @Override
        public int softDelete(UUID runId) {
            RunRecord run = runs.get(runId);
            if (run == null || run.getDeletedAt() != null) {
                return 0;
            }

            run.setDeletedAt(OffsetDateTime.now());
            return 1;
        }

        private List<RunStepRecord> stepsForRun(UUID runId) {
            return steps.values().stream()
                    .filter(step -> runId.equals(step.getRunId()))
                    .sorted(Comparator.comparingInt(RunStepRecord::getStepOrder))
                    .toList();
        }

        private RunStepRecord step(UUID runId, String stepKey) {
            return findStepByRunIdAndStepKey(runId, stepKey).orElseThrow();
        }
    }

    private record RunEventRecord(
            UUID id,
            UUID runId,
            UUID stepId,
            String eventType,
            String source,
            String payloadJson,
            OffsetDateTime occurredAt
    ) {
    }
}
