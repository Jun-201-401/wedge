package com.wedge.analysis.api.internal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AnalyzerCallbackControllerTest {
    private final AnalyzerCallbackService analyzerCallbackService = org.mockito.Mockito.mock(AnalyzerCallbackService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new AnalyzerCallbackController(analyzerCallbackService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void completedCallbackReturnsDataEnvelope() throws Exception {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(analyzerCallbackService.handleCompleted(eq(analysisJobId), any(), any()))
                .thenReturn(Map.of("analysisJobId", analysisJobId, "runId", runId, "status", "COMPLETED"));

        mockMvc.perform(post("/internal/analysis/jobs/{analysisJobId}/completed", analysisJobId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_analyzer_completed")
                        .header("X-Worker-Id", "analyzer_001")
                        .header("X-Event-Id", "evt_analyzer_completed_001")
                        .header("X-Signature", "hmac-sha256=sig")
                        .content(objectMapper.writeValueAsString(completedPayload(analysisJobId, runId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.analysisJobId").value(analysisJobId.toString()))
                .andExpect(jsonPath("$.data.status").value("COMPLETED"))
                .andExpect(jsonPath("$.meta.requestId").value("req_analyzer_completed"));
    }

    private Map<String, Object> completedPayload(UUID analysisJobId, UUID runId) {
        return Map.of(
                "analysisJobId", analysisJobId,
                "runId", runId,
                "analyzerVersion", "analyzer-0.5.0",
                "promptVersion", "judge-prompts-2026-04-21",
                "modelInfo", Map.of("llm", "gpt-5.4-mini"),
                "topFindings", List.of(),
                "nudges", List.of(),
                "judgeResult", Map.of("summary", Map.of(), "issues", List.of(), "decision_map", List.of()),
                "completedAt", "2026-04-28T11:00:00+09:00"
        );
    }
}
