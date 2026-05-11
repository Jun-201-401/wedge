package com.wedge.run.api.internal.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyClaimRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordResponse;
import com.wedge.run.application.RunnerAgentIdempotencyService;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RunnerAgentIdempotencyControllerTest {
    private static final String KEY_HASH = "b".repeat(64);

    private final RunnerAgentIdempotencyService runnerAgentIdempotencyService = org.mockito.Mockito.mock(RunnerAgentIdempotencyService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new RunnerAgentIdempotencyController(runnerAgentIdempotencyService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void getRecordReturnsDataEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerAgentIdempotencyService.findRecord(KEY_HASH)).thenReturn(response(runId));

        mockMvc.perform(get("/internal/runner/agent-idempotency/{keyHash}", KEY_HASH)
                        .header("X-Request-Id", "req_agent_idempotency_get"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.found").value(true))
                .andExpect(jsonPath("$.data.status").value("COMPLETED"))
                .andExpect(jsonPath("$.data.idempotencyKeyHash").value(KEY_HASH))
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.result.trace.outcome.status").value("SUCCESS"))
                .andExpect(jsonPath("$.meta.requestId").value("req_agent_idempotency_get"));

        verify(runnerAgentIdempotencyService).findRecord(KEY_HASH);
    }

    @Test
    void putRecordMapsRequestToService() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerAgentIdempotencyService.persistRecord(eq(KEY_HASH), any(), eq("runner-1")))
                .thenReturn(response(runId));

        mockMvc.perform(put("/internal/runner/agent-idempotency/{keyHash}", KEY_HASH)
                        .header("X-Worker-Id", "runner-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "runId", runId.toString(),
                                "taskId", "task-1",
                                "attemptId", "attempt-1",
                                "attemptIndex", 3,
                                "result", Map.of("trace", Map.of("outcome", Map.of("status", "SUCCESS")))
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.found").value(true));

        ArgumentCaptor<RunnerAgentIdempotencyRecordRequest> requestCaptor =
                ArgumentCaptor.forClass(RunnerAgentIdempotencyRecordRequest.class);
        verify(runnerAgentIdempotencyService).persistRecord(eq(KEY_HASH), requestCaptor.capture(), eq("runner-1"));
        assertThat(requestCaptor.getValue().attemptIndex()).isEqualTo(3);
    }

    @Test
    void claimRecordMapsLeaseRequestToService() throws Exception {
        UUID runId = UUID.randomUUID();
        when(runnerAgentIdempotencyService.claimRecord(eq(KEY_HASH), any(), eq("runner-1")))
                .thenReturn(claimResponse(runId));

        mockMvc.perform(post("/internal/runner/agent-idempotency/{keyHash}/claim", KEY_HASH)
                        .header("X-Worker-Id", "runner-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "runId", runId.toString(),
                                "taskId", "task-1",
                                "attemptId", "attempt-1",
                                "attemptIndex", 3,
                                "leaseTtlMs", 120_000
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.found").value(true))
                .andExpect(jsonPath("$.data.status").value("CLAIMED"))
                .andExpect(jsonPath("$.data.claimedBy").value("runner-1"));

        ArgumentCaptor<RunnerAgentIdempotencyClaimRequest> requestCaptor =
                ArgumentCaptor.forClass(RunnerAgentIdempotencyClaimRequest.class);
        verify(runnerAgentIdempotencyService).claimRecord(eq(KEY_HASH), requestCaptor.capture(), eq("runner-1"));
        assertThat(requestCaptor.getValue().normalizedLeaseTtlMs()).isEqualTo(120_000);
    }

    private RunnerAgentIdempotencyRecordResponse response(UUID runId) {
        return new RunnerAgentIdempotencyRecordResponse(
                KEY_HASH,
                true,
                "COMPLETED",
                runId,
                "task-1",
                "attempt-1",
                3,
                "runner-1",
                OffsetDateTime.parse("2026-05-08T09:55:00+09:00"),
                OffsetDateTime.parse("2026-05-08T10:05:00+09:00"),
                Map.of("trace", Map.of("outcome", Map.of("status", "SUCCESS"))),
                OffsetDateTime.parse("2026-05-08T10:00:00+09:00")
        );
    }

    private RunnerAgentIdempotencyRecordResponse claimResponse(UUID runId) {
        return new RunnerAgentIdempotencyRecordResponse(
                KEY_HASH,
                true,
                "CLAIMED",
                runId,
                "task-1",
                "attempt-1",
                3,
                "runner-1",
                OffsetDateTime.parse("2026-05-08T10:00:00+09:00"),
                OffsetDateTime.parse("2026-05-08T10:02:00+09:00"),
                null,
                null
        );
    }
}
