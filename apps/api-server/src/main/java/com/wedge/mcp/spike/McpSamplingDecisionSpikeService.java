package com.wedge.mcp.spike;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.mcp.spike.dto.SamplingDecisionSpikeResponse;
import com.wedge.mcp.spike.dto.SpikeAgentDecision;
import com.wedge.mcp.spike.dto.SpikeAgentObservation;
import io.modelcontextprotocol.spec.McpSchema;
import java.util.Locale;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.context.McpSyncRequestContext;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpSamplingDecisionSpikeService {
    private static final int MAX_REASON_LENGTH = 300;
    private static final Set<String> ALLOWED_DECISION_TYPES = Set.of("ACT", "FINISH", "WAIT");
    private static final Set<String> FORBIDDEN_TEXT_MARKERS = Set.of(
            "document.",
            "window.",
            "<script",
            "javascript:",
            "bearer ",
            "token",
            "secret",
            "password",
            "cookie",
            "localstorage",
            "sessionstorage",
            "xpath=",
            "css="
    );

    private final ObjectMapper objectMapper;

    public SamplingDecisionSpikeResponse run(McpSyncRequestContext context) {
        String sessionId = sessionId(context);
        String clientName = clientName(context);

        if (context == null || !context.sampleEnabled()) {
            return SamplingDecisionSpikeResponse.unsupported(
                    sessionId,
                    clientName,
                    "Connected MCP client did not declare sampling capability."
            );
        }

        SpikeAgentObservation observation = SpikeAgentObservation.fixture();
        McpSchema.CreateMessageRequest request;
        try {
            request = buildSamplingRequest(observation);
        } catch (JsonProcessingException exception) {
            return SamplingDecisionSpikeResponse.failure(
                    true,
                    sessionId,
                    clientName,
                    "MCP_SAMPLING_REQUEST_BUILD_FAILED",
                    "Failed to build sampling request."
            );
        }

        McpSchema.CreateMessageResult result;
        try {
            result = context.sample(request);
        } catch (RuntimeException exception) {
            return SamplingDecisionSpikeResponse.failure(
                    true,
                    sessionId,
                    clientName,
                    "MCP_SAMPLING_REQUEST_FAILED",
                    "MCP sampling request failed: " + exception.getMessage()
            );
        }

        String rawDecision = extractText(result);
        if (rawDecision == null || rawDecision.isBlank()) {
            return SamplingDecisionSpikeResponse.failure(
                    true,
                    sessionId,
                    clientName,
                    "MCP_SAMPLING_NON_TEXT_RESULT",
                    "MCP sampling result did not contain text content."
            );
        }

        SpikeAgentDecision decision;
        try {
            decision = objectMapper.readValue(rawDecision, SpikeAgentDecision.class);
        } catch (JsonProcessingException exception) {
            return SamplingDecisionSpikeResponse.failure(
                    true,
                    sessionId,
                    clientName,
                    "MCP_SAMPLING_INVALID_JSON",
                    "MCP sampling result was not valid AgentDecision JSON."
            );
        }

        String validationError = validateDecision(decision, observation);
        if (validationError != null) {
            return SamplingDecisionSpikeResponse.failure(
                    true,
                    sessionId,
                    clientName,
                    "MCP_SAMPLING_INVALID_DECISION",
                    validationError
            );
        }

        return SamplingDecisionSpikeResponse.success(
                sessionId,
                clientName,
                result == null ? null : result.model(),
                result == null || result.stopReason() == null ? null : result.stopReason().name(),
                decision
        );
    }

    private McpSchema.CreateMessageRequest buildSamplingRequest(SpikeAgentObservation observation)
            throws JsonProcessingException {
        String prompt = """
                Decide the next action for this Wedge fixture observation.
                Return only AgentDecision JSON. Do not include markdown.
                Allowed decisionType values: ACT, FINISH, WAIT.
                For ACT, tool and candidateId must come from allowedActions and candidates.

                Observation:
                %s
                """.formatted(objectMapper.writeValueAsString(observation));

        return McpSchema.CreateMessageRequest.builder()
                .systemPrompt("You are a Wedge decision spike client. Return only strict JSON.")
                .includeContext(McpSchema.CreateMessageRequest.ContextInclusionStrategy.NONE)
                .temperature(0.0)
                .maxTokens(500)
                .messages(java.util.List.of(new McpSchema.SamplingMessage(
                        McpSchema.Role.USER,
                        new McpSchema.TextContent(prompt)
                )))
                .build();
    }

    private String extractText(McpSchema.CreateMessageResult result) {
        if (result == null || !(result.content() instanceof McpSchema.TextContent textContent)) {
            return null;
        }
        return textContent.text();
    }

    private String validateDecision(SpikeAgentDecision decision, SpikeAgentObservation observation) {
        if (decision == null) {
            return "AgentDecision is required.";
        }
        if (isBlank(decision.decisionType()) || !ALLOWED_DECISION_TYPES.contains(decision.decisionType())) {
            return "decisionType must be one of ACT, FINISH, WAIT.";
        }
        if (isBlank(decision.reason()) || decision.reason().length() > MAX_REASON_LENGTH) {
            return "reason is required and must be at most 300 characters.";
        }
        if (decision.confidence() == null || decision.confidence() < 0.0 || decision.confidence() > 1.0) {
            return "confidence must be between 0.0 and 1.0.";
        }
        if ("ACT".equals(decision.decisionType())) {
            if (isBlank(decision.tool()) || !observation.allowedActionSet().contains(decision.tool())) {
                return "tool must be one of the allowedActions.";
            }
            if (isBlank(decision.candidateId()) || !observation.allowedCandidateIds().contains(decision.candidateId())) {
                return "candidateId must be one of the fixture candidates.";
            }
        }
        if (containsForbiddenText(decision)) {
            return "AgentDecision contains forbidden raw execution or secret-like text.";
        }
        return null;
    }

    private boolean containsForbiddenText(SpikeAgentDecision decision) {
        String combined = String.join(" ",
                safe(decision.decisionType()),
                safe(decision.tool()),
                safe(decision.candidateId()),
                safe(decision.reason())
        ).toLowerCase(Locale.ROOT);

        return FORBIDDEN_TEXT_MARKERS.stream().anyMatch(combined::contains);
    }

    private String sessionId(McpSyncRequestContext context) {
        return context == null ? null : context.sessionId();
    }

    private String clientName(McpSyncRequestContext context) {
        if (context == null) {
            return null;
        }
        McpSchema.Implementation clientInfo = context.clientInfo();
        return clientInfo == null ? null : clientInfo.name();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }
}
