package com.wedge.internal.runner;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RunnerCallbackControllerTest {
    private final RunnerCallbackService runnerCallbackService = org.mockito.Mockito.mock(RunnerCallbackService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new RunnerCallbackController(runnerCallbackService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void acceptedCallbackReturnsDataEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.handleAccepted(eq(runId), any(), any()))
                .thenReturn(Map.of("runId", runId, "status", "STARTING"));

        mockMvc.perform(post("/internal/runner/runs/{runId}/accepted", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_runner_accepted")
                        .header("X-Worker-Id", "runner_001")
                        .header("X-Event-Id", "evt_accepted_001")
                        .header("X-Signature", "hmac-sha256=sig")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "workerId", "runner_001",
                                "acceptedAt", "2026-04-21T10:00:00+09:00",
                                "browserSessionId", "browser-1"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.status").value("STARTING"))
                .andExpect(jsonPath("$.meta.requestId").value("req_runner_accepted"));
    }

    @Test
    void checkpointCallbackReturnsAcceptedStatus() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerCallbackService.handleCheckpoints(eq(runId), any(), any()))
                .thenReturn(Map.of("runId", runId, "checkpointCount", 1));

        mockMvc.perform(post("/internal/runner/runs/{runId}/checkpoints", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_runner_checkpoints")
                        .header("X-Worker-Id", "runner_001")
                        .header("X-Event-Id", "evt_checkpoint_001")
                        .header("X-Signature", "hmac-sha256=sig")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "checkpoints", new Object[] {
                                        Map.of(
                                                "checkpointId", "cp_001",
                                                "stepKey", "step_001_goto",
                                                "stage", "FIRST_VIEW",
                                                "trigger", Map.of("type", "goto"),
                                                "settle", Map.of("strategy", "network_idle", "durationMs", 1000, "status", "settled"),
                                                "state", Map.of(),
                                                "observations", new Object[] {},
                                                "deltas", new Object[] {},
                                                "artifactRefs", new Object[] {}
                                        )
                                }
                        ))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.checkpointCount").value(1))
                .andExpect(jsonPath("$.meta.requestId").value("req_runner_checkpoints"));
    }
}
