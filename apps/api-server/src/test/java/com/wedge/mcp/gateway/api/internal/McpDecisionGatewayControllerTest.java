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
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
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
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new McpDecisionGatewayController(service))
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
}
