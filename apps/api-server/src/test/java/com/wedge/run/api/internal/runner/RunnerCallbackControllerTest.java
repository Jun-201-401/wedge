package com.wedge.run.api.internal.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.run.api.internal.runner.dto.RunnerArtifactType;
import com.wedge.run.api.internal.runner.dto.RunnerControlStateResponse;
import com.wedge.run.application.RunnerCallbackAckResponse;
import com.wedge.run.application.RunnerCallbackService;
import com.wedge.run.application.command.RunnerAcceptedCommand;
import com.wedge.run.application.command.RunnerAgentEventsCommand;
import com.wedge.run.application.command.RunnerAgentTraceCommand;
import com.wedge.run.application.command.RunnerArtifactsCommand;
import com.wedge.common.internal.InternalCallbackContext;
import com.wedge.run.application.command.RunnerCheckpointsCommand;
import com.wedge.run.application.command.RunnerFailedCommand;
import com.wedge.run.application.command.RunnerFinishedCommand;
import com.wedge.run.application.command.RunnerStepEventsCommand;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RunnerCallbackControllerTest {
    private final RunnerCallbackService runnerCallbackService = org.mockito.Mockito.mock(RunnerCallbackService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new RunnerCallbackController(runnerCallbackService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void acceptedCallbackMapsRequestToCommandAndReturnsDataEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.handleAccepted(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.STARTING, null, null, null, null, null));

        postJson(runId, "accepted", "req_runner_accepted", "evt_accepted_001", Map.of(
                        "workerId", "runner_001",
                        "acceptedAt", "2026-04-21T10:00:00+09:00",
                        "browserSessionId", "browser-1"
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.status").value("STARTING"))
                .andExpect(jsonPath("$.meta.requestId").value("req_runner_accepted"));

        ArgumentCaptor<RunnerAcceptedCommand> commandCaptor = ArgumentCaptor.forClass(RunnerAcceptedCommand.class);
        ArgumentCaptor<InternalCallbackContext> contextCaptor = ArgumentCaptor.forClass(InternalCallbackContext.class);
        verify(runnerCallbackService).handleAccepted(eq(runId), commandCaptor.capture(), contextCaptor.capture());
        assertThat(commandCaptor.getValue().workerId()).isEqualTo("runner_001");
        assertThat(commandCaptor.getValue().acceptedAt().toString()).isEqualTo("2026-04-21T01:00Z");
        assertThat(commandCaptor.getValue().browserSessionId()).isEqualTo("browser-1");
        assertThat(contextCaptor.getValue()).isEqualTo(new InternalCallbackContext("runner_001", "evt_accepted_001", "hmac-sha256=sig"));
    }

    @Test
    void stepEventsCallbackMapsRequestToCommand() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        when(runnerCallbackService.handleStepEvents(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.RUNNING, null, 1, null, null, null));

        postJson(runId, "step-events", "req_runner_steps", "evt_step_batch_001", Map.of(
                        "events", List.of(Map.of(
                                "eventId", eventId.toString(),
                                "stepOrder", 2,
                                "stepKey", "step_002_click_signup",
                                "eventType", "STEP_COMPLETED",
                                "occurredAt", "2026-04-21T10:01:00+09:00",
                                "payload", Map.of("message", "done")
                        ))
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.eventCount").value(1));

        ArgumentCaptor<RunnerStepEventsCommand> commandCaptor = ArgumentCaptor.forClass(RunnerStepEventsCommand.class);
        verify(runnerCallbackService).handleStepEvents(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().events()).singleElement().satisfies(event -> {
            assertThat(event.eventId()).isEqualTo(eventId);
            assertThat(event.stepOrder()).isEqualTo(2);
            assertThat(event.stepKey()).isEqualTo("step_002_click_signup");
            assertThat(event.eventType()).isEqualTo("STEP_COMPLETED");
            assertThat(event.occurredAt().toString()).isEqualTo("2026-04-21T01:01Z");
            assertThat(event.payload()).isEqualTo(Map.of("message", "done"));
        });
    }

    @Test
    void checkpointCallbackMapsRequestToRunCommandAndReturnsAcceptedStatus() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.handleCheckpoints(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, null, null, null, 1, null, null));

        postJson(runId, "checkpoints", "req_runner_checkpoints", "evt_checkpoint_001", checkpointBody())
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.checkpointCount").value(1))
                .andExpect(jsonPath("$.data.status").doesNotExist())
                .andExpect(jsonPath("$.data.resultCompleteness").doesNotExist())
                .andExpect(jsonPath("$.meta.requestId").value("req_runner_checkpoints"));

        ArgumentCaptor<RunnerCheckpointsCommand> commandCaptor = ArgumentCaptor.forClass(RunnerCheckpointsCommand.class);
        verify(runnerCallbackService).handleCheckpoints(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().checkpoints()).singleElement().satisfies(checkpoint -> {
            assertThat(checkpoint.checkpointId()).isEqualTo("cp_001");
            assertThat(checkpoint.stepKey()).isEqualTo("step_001_goto");
            assertThat(checkpoint.stage()).isEqualTo("FIRST_VIEW");
            assertThat(checkpoint.trigger()).isEqualTo(Map.of("type", "goto"));
            assertThat(checkpoint.settle()).isEqualTo(Map.of("strategy", "network_idle", "durationMs", 1000, "status", "settled"));
            assertThat(checkpoint.durationMs()).isEqualTo(1000);
            assertThat(checkpoint.state()).isEqualTo(Map.of("url", "https://example.com"));
            assertThat(checkpoint.observations()).containsExactly(Map.of("type", "hero"));
            assertThat(checkpoint.deltas()).containsExactly(Map.of("field", "title"));
            assertThat(checkpoint.artifactRefs()).containsExactly("artifact:screenshot_cp_001");
        });
    }

    @Test
    void artifactCallbackMapsRequestToRunCommand() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(runnerCallbackService.handleArtifacts(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, null, null, null, null, 1, null));

        postJson(runId, "artifacts", "req_runner_artifacts", "evt_artifact_001", Map.of(
                        "artifacts", List.of(artifactBody(artifactId))
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.artifactCount").value(1))
                .andExpect(jsonPath("$.data.status").doesNotExist())
                .andExpect(jsonPath("$.data.resultCompleteness").doesNotExist());

        ArgumentCaptor<RunnerArtifactsCommand> commandCaptor = ArgumentCaptor.forClass(RunnerArtifactsCommand.class);
        verify(runnerCallbackService).handleArtifacts(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().artifacts()).singleElement().satisfies(artifact -> {
            assertThat(artifact.artifactId()).isEqualTo(artifactId);
            assertThat(artifact.stepKey()).isEqualTo("step_002_click_signup");
            assertThat(artifact.artifactType()).isEqualTo("SCREENSHOT");
            assertThat(artifact.bucket()).isEqualTo("bucket-a");
            assertThat(artifact.key()).isEqualTo("runs/a/shot.png");
            assertThat(artifact.mimeType()).isEqualTo("image/png");
            assertThat(artifact.width()).isEqualTo(1440);
            assertThat(artifact.height()).isEqualTo(900);
            assertThat(artifact.sizeBytes()).isEqualTo(42L);
            assertThat(artifact.sha256()).isEqualTo("abc123");
            assertThat(artifact.createdAt().toString()).isEqualTo("2026-04-21T01:02Z");
        });
    }

    @Test
    void finishedCallbackMapsRequestToCommand() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.handleFinished(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.COMPLETED, ResultCompleteness.FINAL, null, null, null, null));

        postJson(runId, "finished", "req_runner_finished", "evt_finished_001", Map.of(
                        "workerId", "runner_001",
                        "executionFinishedAt", "2026-04-21T10:05:00+09:00",
                        "summary", Map.of("completedStepCount", 5, "failedStepCount", 0, "stopped", false)
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("COMPLETED"));

        ArgumentCaptor<RunnerFinishedCommand> commandCaptor = ArgumentCaptor.forClass(RunnerFinishedCommand.class);
        verify(runnerCallbackService).handleFinished(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().workerId()).isEqualTo("runner_001");
        assertThat(commandCaptor.getValue().executionFinishedAt().toString()).isEqualTo("2026-04-21T01:05Z");
        assertThat(commandCaptor.getValue().completedStepCount()).isEqualTo(5);
        assertThat(commandCaptor.getValue().failedStepCount()).isZero();
        assertThat(commandCaptor.getValue().stopped()).isFalse();
    }

    @Test
    void failedCallbackMapsRequestToCommand() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.handleFailed(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.FAILED, ResultCompleteness.PARTIAL, null, null, null, null));

        postJson(runId, "failed", "req_runner_failed", "evt_failed_001", Map.of(
                        "workerId", "runner_001",
                        "failedAt", "2026-04-21T10:03:00+09:00",
                        "failureCode", "RUNNER_TIMEOUT",
                        "failureMessage", "Runner callback timed out",
                        "resultCompleteness", "PARTIAL",
                        "summary", Map.of("completedStepCount", 3, "failedStepCount", 1, "stopped", false)
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FAILED"));

        ArgumentCaptor<RunnerFailedCommand> commandCaptor = ArgumentCaptor.forClass(RunnerFailedCommand.class);
        verify(runnerCallbackService).handleFailed(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().workerId()).isEqualTo("runner_001");
        assertThat(commandCaptor.getValue().failedAt().toString()).isEqualTo("2026-04-21T01:03Z");
        assertThat(commandCaptor.getValue().failureCode()).isEqualTo("RUNNER_TIMEOUT");
        assertThat(commandCaptor.getValue().failureMessage()).isEqualTo("Runner callback timed out");
        assertThat(commandCaptor.getValue().resultCompleteness()).isEqualTo(ResultCompleteness.PARTIAL);
        assertThat(commandCaptor.getValue().completedStepCount()).isEqualTo(3);
        assertThat(commandCaptor.getValue().failedStepCount()).isEqualTo(1);
        assertThat(commandCaptor.getValue().stopped()).isFalse();
    }

    @Test
    void controlStateReturnsStopRequestedForRunnerPolling() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.getControlState(runId))
                .thenReturn(new RunnerControlStateResponse(runId, RunStatus.STOP_REQUESTED, true, ResultCompleteness.PARTIAL));

        mockMvc.perform(get("/internal/runner/runs/{runId}/control-state", runId)
                        .header("X-Worker-Id", "runner_001")
                        .header("X-Request-Id", "req_runner_control"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.status").value("STOP_REQUESTED"))
                .andExpect(jsonPath("$.data.stopRequested").value(true))
                .andExpect(jsonPath("$.data.resultCompleteness").value("PARTIAL"))
                .andExpect(jsonPath("$.meta.requestId").value("req_runner_control"));

        verify(runnerCallbackService).getControlState(runId);
    }

    @Test
    void agentEventsCallbackMapsRequestToCommand() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID agentEventId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        when(runnerCallbackService.handleAgentEvents(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.RUNNING, null, 1, null, null, null));

        postJson(runId, "agent-events", "req_agent_events", "evt_agent_batch_001", Map.of(
                        "events", List.of(Map.of(
                                "eventId", agentEventId.toString(),
                                "taskId", taskId.toString(),
                                "attemptId", attemptId.toString(),
                                "turn", 1,
                                "eventType", "POLICY_CHECKED",
                                "occurredAt", "2026-05-06T09:00:00+09:00",
                                "payload", Map.of("final_outcome", "SUCCESS_CHECKOUT_ENTRY_REACHED")
                        ))
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.eventCount").value(1));

        ArgumentCaptor<RunnerAgentEventsCommand> commandCaptor = ArgumentCaptor.forClass(RunnerAgentEventsCommand.class);
        verify(runnerCallbackService).handleAgentEvents(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().events()).singleElement().satisfies(event -> {
            assertThat(event.eventId()).isEqualTo(agentEventId.toString());
            assertThat(event.taskId()).isEqualTo(taskId);
            assertThat(event.attemptId()).isEqualTo(attemptId);
            assertThat(event.stepIndex()).isEqualTo(1);
            assertThat(event.eventType()).isEqualTo("POLICY_CHECKED");
            assertThat(event.occurredAt().toString()).isEqualTo("2026-05-06T00:00Z");
            assertThat(event.payload()).isEqualTo(Map.of("final_outcome", "SUCCESS_CHECKOUT_ENTRY_REACHED"));
        });
    }

    @Test
    void agentEventsCallbackDefaultsMissingTurnToGlobalStepIndex() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID agentEventId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        when(runnerCallbackService.handleAgentEvents(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.RUNNING, null, 1, null, null, null));

        postJson(runId, "agent-events", "req_agent_event_no_turn", "evt_agent_event_no_turn", Map.of(
                        "events", List.of(Map.of(
                                "eventId", agentEventId.toString(),
                                "taskId", taskId.toString(),
                                "attemptId", attemptId.toString(),
                                "eventType", "TRACE_PERSISTED",
                                "occurredAt", "2026-05-06T09:00:00+09:00",
                                "payload", Map.of("traceArtifactId", "artifact-1")
                        ))
                ))
                .andExpect(status().isOk());

        ArgumentCaptor<RunnerAgentEventsCommand> commandCaptor = ArgumentCaptor.forClass(RunnerAgentEventsCommand.class);
        verify(runnerCallbackService).handleAgentEvents(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().events()).singleElement()
                .satisfies(event -> assertThat(event.stepIndex()).isZero());
    }

    @Test
    void agentEventsCallbackRejectsUnknownEventTypeBeforeService() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();

        postJson(runId, "agent-events", "req_agent_event_bad_type", "evt_agent_event_bad_type", Map.of(
                        "events", List.of(Map.of(
                                "eventId", UUID.randomUUID().toString(),
                                "taskId", taskId.toString(),
                                "attemptId", attemptId.toString(),
                                "turn", 1,
                                "eventType", "UNKNOWN_EVENT",
                                "occurredAt", "2026-05-06T09:00:00+09:00",
                                "payload", Map.of()
                        ))
                ))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));

        verifyNoInteractions(runnerCallbackService);
    }

    @Test
    void agentTraceCallbackMapsRequestToCommand() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        when(runnerCallbackService.handleAgentTrace(eq(runId), any(), any()))
                .thenReturn(new RunnerCallbackAckResponse(runId, RunStatus.RUNNING, null, null, null, null, null));

        postJson(runId, "agent-traces", "req_agent_trace", "evt_agent_trace_001", Map.of(
                        "taskId", taskId.toString(),
                        "attemptId", attemptId.toString(),
                        "occurredAt", "2026-05-06T09:00:05+09:00",
                        "trace", Map.of(
                                "schema_version", "0.1",
                                "run_id", runId.toString(),
                                "final_outcome", "SUCCESS_CHECKOUT_ENTRY_REACHED",
                                "events", List.of()
                        )
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()));

        ArgumentCaptor<RunnerAgentTraceCommand> commandCaptor = ArgumentCaptor.forClass(RunnerAgentTraceCommand.class);
        verify(runnerCallbackService).handleAgentTrace(eq(runId), commandCaptor.capture(), any());
        assertThat(commandCaptor.getValue().taskId()).isEqualTo(taskId);
        assertThat(commandCaptor.getValue().attemptId()).isEqualTo(attemptId);
        assertThat(commandCaptor.getValue().occurredAt().toString()).isEqualTo("2026-05-06T00:00:05Z");
        assertThat(commandCaptor.getValue().trace()).containsEntry("run_id", runId.toString());
        assertThat(commandCaptor.getValue().trace()).doesNotContainKey("finished_at");
    }

    @Test
    void agentTraceCallbackRejectsConflictingTraceIdentityBeforeService() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();

        postJson(runId, "agent-traces", "req_agent_trace_conflict", "evt_agent_trace_conflict", Map.of(
                        "taskId", taskId.toString(),
                        "attemptId", attemptId.toString(),
                        "occurredAt", "2026-05-06T09:00:05+09:00",
                        "trace", Map.of(
                                "schema_version", "0.1",
                                "run_id", UUID.randomUUID().toString(),
                                "task_id", taskId.toString(),
                                "attempt_id", attemptId.toString(),
                                "turns", List.of(),
                                "outcome", Map.of("status", "SUCCESS", "reason", "done")
                        )
                ))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"));

        verifyNoInteractions(runnerCallbackService);
    }

    @Test
    void emptyCallbackBatchesAreRejectedBeforeService() throws Exception {
        UUID runId = UUID.randomUUID();

        postJson(runId, "step-events", "req_empty_steps", "evt_empty_steps", Map.of("events", List.of()))
                .andExpect(status().isUnprocessableEntity());
        postJson(runId, "checkpoints", "req_empty_checkpoints", "evt_empty_checkpoints", Map.of("checkpoints", List.of()))
                .andExpect(status().isUnprocessableEntity());
        postJson(runId, "artifacts", "req_empty_artifacts", "evt_empty_artifacts", Map.of("artifacts", List.of()))
                .andExpect(status().isUnprocessableEntity());
        postJson(runId, "agent-events", "req_empty_agent_events", "evt_empty_agent_events", Map.of("events", List.of()))
                .andExpect(status().isUnprocessableEntity());

        verifyNoInteractions(runnerCallbackService);
    }

    @Test
    void runnerArtifactTypesStayCompatibleWithEvidenceArtifactTypes() {
        for (RunnerArtifactType type : RunnerArtifactType.values()) {
            assertThatCode(() -> ArtifactType.valueOf(type.name()))
                    .as("Runner artifact type %s should map to evidence ArtifactType", type)
                    .doesNotThrowAnyException();
        }
    }

    private ResultActions postJson(UUID runId, String path, String requestId, String eventId, Map<String, Object> body) throws Exception {
        return mockMvc.perform(post("/internal/runner/runs/{runId}/{path}", runId, path)
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Request-Id", requestId)
                .header("X-Worker-Id", "runner_001")
                .header("X-Event-Id", eventId)
                .header("X-Signature", "hmac-sha256=sig")
                .content(objectMapper.writeValueAsString(body)));
    }

    private Map<String, Object> artifactBody(UUID artifactId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("artifactId", artifactId.toString());
        body.put("stepKey", "step_002_click_signup");
        body.put("artifactType", "SCREENSHOT");
        body.put("bucket", "bucket-a");
        body.put("key", "runs/a/shot.png");
        body.put("mimeType", "image/png");
        body.put("width", 1440);
        body.put("height", 900);
        body.put("sizeBytes", 42);
        body.put("sha256", "abc123");
        body.put("createdAt", "2026-04-21T10:02:00+09:00");
        return body;
    }

    private Map<String, Object> checkpointBody() {
        return Map.of(
                "checkpoints", List.of(Map.of(
                        "checkpointId", "cp_001",
                        "stepKey", "step_001_goto",
                        "stage", "FIRST_VIEW",
                        "trigger", Map.of("type", "goto"),
                        "settle", Map.of("strategy", "network_idle", "durationMs", 1000, "status", "settled"),
                        "state", Map.of("url", "https://example.com"),
                        "observations", List.of(Map.of("type", "hero")),
                        "deltas", List.of(Map.of("field", "title")),
                        "artifactRefs", List.of("artifact:screenshot_cp_001")
                ))
        );
    }
}
