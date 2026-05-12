package com.wedge.mcp.gateway.api.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.mcp.gateway.application.McpDecisionGatewayService;
import com.wedge.mcp.gateway.application.McpPendingDecision;
import com.wedge.mcp.gateway.application.McpPendingDecisionService;
import com.wedge.mcp.gateway.application.McpPendingDecisionStatus;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class McpDecisionGatewayControllerTest {
    private final McpDecisionGatewayService service = org.mockito.Mockito.mock(McpDecisionGatewayService.class);
    private final McpPendingDecisionService pendingDecisionService = org.mockito.Mockito.mock(McpPendingDecisionService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new McpDecisionGatewayController(service, pendingDecisionService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void requestDecisionMapsConstrainedObservationAndReturnsTypedUnavailableFailure() throws Exception {
        doThrow(new BusinessException(
                ErrorCode.MCP_SESSION_UNAVAILABLE,
                "No active MCP host session is available for MCP decision sampling."
        )).when(service).requestDecision(any());

        mockMvc.perform(post("/internal/agent/mcp/decision")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-Id", "req_mcp_decision_001")
                        .content(objectMapper.writeValueAsString(validRequest())))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("mcp_session_unavailable"))
                .andExpect(jsonPath("$.error.message").value("No active MCP host session is available for MCP decision sampling."))
                .andExpect(jsonPath("$.meta.requestId").value("req_mcp_decision_001"));

        ArgumentCaptor<McpDecisionGatewayCommand> commandCaptor = ArgumentCaptor.forClass(McpDecisionGatewayCommand.class);
        verify(service).requestDecision(commandCaptor.capture());

        McpDecisionGatewayCommand command = commandCaptor.getValue();
        assertThat(command.runId()).isEqualTo(UUID.fromString("00000000-0000-4000-8000-000000000601"));
        assertThat(command.goal()).isEqualTo("Find checkout");
        assertThat(command.startUrl()).isEqualTo("https://example.com/product");
        assertThat(command.state().started()).isTrue();
        assertThat(command.allowedActions()).containsExactly("click", "scroll", "checkpoint", "finish");
        assertThat(command.page().candidates()).singleElement().satisfies(candidate -> {
            assertThat(candidate.targetKey()).isEqualTo("candidate_001");
            assertThat(candidate.text()).isEqualTo("Checkout");
            assertThat(candidate.primaryLike()).isTrue();
            assertThat(candidate.ctaCandidate()).isTrue();
        });
    }

    @Test
    void requestDecisionValidatesRequiredFields() throws Exception {
        mockMvc.perform(post("/internal/agent/mcp/decision")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "goal", "",
                                "startUrl", "",
                                "allowedActions", List.of()
                        ))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void createPendingDecisionReturnsAcceptedPendingRecord() throws Exception {
        org.mockito.Mockito.when(pendingDecisionService.create(any())).thenReturn(pendingDecision());

        mockMvc.perform(post("/internal/agent/mcp/pending-decisions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(validRequest())))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.pendingDecisionId").value("00000000-0000-4000-8000-000000000701"))
                .andExpect(jsonPath("$.data.runId").value("00000000-0000-4000-8000-000000000601"))
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.sessionId").value("session-1"))
                .andExpect(jsonPath("$.data.clientName").value("inspector-client"));
    }

    @Test
    void getPendingDecisionReturnsCurrentRecordStatus() throws Exception {
        org.mockito.Mockito.when(pendingDecisionService.get(UUID.fromString("00000000-0000-4000-8000-000000000701")))
                .thenReturn(pendingDecision());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/internal/agent/mcp/pending-decisions/00000000-0000-4000-8000-000000000701"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pendingDecisionId").value("00000000-0000-4000-8000-000000000701"))
                .andExpect(jsonPath("$.data.status").value("PENDING"));
    }

    private Map<String, Object> validRequest() {
        return Map.of(
                "runId", "00000000-0000-4000-8000-000000000601",
                "goal", "Find checkout",
                "startUrl", "https://example.com/product",
                "state", Map.of(
                        "started", true,
                        "scrollCount", 1,
                        "clickedTargetKeys", List.of("#signup")
                ),
                "page", Map.of(
                        "finalUrl", "https://example.com/product",
                        "title", "Product",
                        "candidates", List.of(Map.of(
                                "targetKey", "candidate_001",
                                "text", "Checkout",
                                "role", "link",
                                "tag", "a",
                                "isPrimaryLike", true,
                                "isCtaCandidate", true
                        ))
                ),
                "allowedActions", List.of("click", "scroll", "checkpoint", "finish"),
                "outputSchema", Map.of(
                        "kind", "act|checkpoint|finish",
                        "actionType", "goto|click|scroll|checkpoint",
                        "targetKey", "opaque candidate targetKey for click, null otherwise",
                        "scrollY", "number, only for scroll",
                        "stage", "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
                        "reason", "short reason",
                        "confidence", "0..1"
                )
        );
    }

    private McpPendingDecision pendingDecision() {
        return new McpPendingDecision(
                UUID.fromString("00000000-0000-4000-8000-000000000701"),
                UUID.fromString("00000000-0000-4000-8000-000000000601"),
                "session-1",
                "inspector-client",
                command(),
                McpPendingDecisionStatus.PENDING,
                Instant.parse("2026-05-11T01:00:00Z"),
                Instant.parse("2026-05-11T01:02:00Z"),
                null
        );
    }

    private McpDecisionGatewayCommand command() {
        return new McpDecisionGatewayCommand(
                UUID.fromString("00000000-0000-4000-8000-000000000601"),
                "Find checkout",
                "https://example.com/product",
                new McpDecisionGatewayCommand.AgentState(true, 1, List.of("#signup")),
                new McpDecisionGatewayCommand.PageObservation(
                        "https://example.com/product",
                        "Product",
                        List.of(new McpDecisionGatewayCommand.Candidate(
                                "candidate_001",
                                "Checkout",
                                "link",
                                "a",
                                true,
                                true
                        ))
                ),
                List.of("click", "scroll", "checkpoint", "finish"),
                new McpDecisionGatewayCommand.OutputSchema(
                        "act|checkpoint|finish",
                        "goto|click|scroll|checkpoint",
                        "opaque candidate targetKey for click, null otherwise",
                        "number, only for scroll",
                        "FIRST_VIEW|VALUE|CTA|INPUT|COMMIT",
                        "short reason",
                        "0..1"
                )
        );
    }
}
