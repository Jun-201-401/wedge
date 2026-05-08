package com.wedge.mcp.gateway.api.internal;

import com.wedge.common.response.ApiResponse;
import com.wedge.mcp.gateway.api.internal.dto.McpDecisionGatewayRequest;
import com.wedge.mcp.gateway.application.McpDecisionGatewayService;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/agent/mcp")
@RequiredArgsConstructor
public class McpDecisionGatewayController {
    private final McpDecisionGatewayService service;

    @PostMapping("/decision")
    public ResponseEntity<ApiResponse<Void>> requestDecision(@Valid @RequestBody McpDecisionGatewayRequest request) {
        service.requestDecision(toCommand(request));
        return ApiResponse.ok(null);
    }

    private McpDecisionGatewayCommand toCommand(McpDecisionGatewayRequest request) {
        return new McpDecisionGatewayCommand(
                request.goal(),
                request.startUrl(),
                new McpDecisionGatewayCommand.AgentState(
                        request.state().started(),
                        request.state().scrollCount(),
                        request.state().clickedTargetKeys()
                ),
                new McpDecisionGatewayCommand.PageObservation(
                        request.page().finalUrl(),
                        request.page().title(),
                        request.page().candidates().stream()
                                .map(candidate -> new McpDecisionGatewayCommand.Candidate(
                                        candidate.targetKey(),
                                        candidate.text(),
                                        candidate.role(),
                                        candidate.tag(),
                                        candidate.isPrimaryLike(),
                                        candidate.isCtaCandidate()
                                ))
                                .toList()
                ),
                request.allowedActions(),
                new McpDecisionGatewayCommand.OutputSchema(
                        request.outputSchema().kind(),
                        request.outputSchema().actionType(),
                        request.outputSchema().targetKey(),
                        request.outputSchema().scrollY(),
                        request.outputSchema().stage(),
                        request.outputSchema().reason(),
                        request.outputSchema().confidence()
                )
        );
    }
}
