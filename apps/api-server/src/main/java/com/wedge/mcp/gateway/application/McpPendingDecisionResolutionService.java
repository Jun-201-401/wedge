package com.wedge.mcp.gateway.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.gateway.api.dto.ResolveMcpPendingDecisionResponse;
import com.wedge.mcp.gateway.application.command.McpDecisionGatewayCommand;
import io.modelcontextprotocol.spec.McpSchema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springaicommunity.mcp.context.McpSyncRequestContext;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class McpPendingDecisionResolutionService {
    private static final int MAX_REASON_LENGTH = 500;
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };
    private static final Set<String> ALLOWED_KINDS = Set.of("act", "checkpoint", "finish");
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

    private final McpPendingDecisionRegistry pendingDecisionRegistry;
    private final ObjectMapper objectMapper;

    public ResolveMcpPendingDecisionResponse resolveNext(McpSyncRequestContext context) {
        if (context == null || isBlank(context.sessionId())) {
            throw new BusinessException(
                    ErrorCode.MCP_SESSION_UNAVAILABLE,
                    "MCP pending decision resolution requires a stateful MCP host session."
            );
        }

        if (!context.sampleEnabled()) {
            throw new BusinessException(
                    ErrorCode.MCP_SESSION_UNAVAILABLE,
                    "Registered MCP host session does not support sampling."
            );
        }

        McpPendingDecision pendingDecision = pendingDecisionRegistry.findNextPendingForSession(context.sessionId())
                .orElse(null);
        if (pendingDecision == null) {
            return ResolveMcpPendingDecisionResponse.none("No pending MCP decision is available for this session.");
        }

        McpSchema.CreateMessageResult result;
        try {
            result = context.sample(buildSamplingRequest(pendingDecision));
        } catch (RuntimeException exception) {
            throw new BusinessException(
                    ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE,
                    "MCP sampling request failed while resolving pending decision.",
                    Map.of("pendingDecisionId", pendingDecision.id().toString())
            );
        }

        Map<String, Object> decision = parseDecision(extractText(result));
        validateDecision(decision, pendingDecision.command());
        McpPendingDecision completed = pendingDecisionRegistry.complete(pendingDecision.id(), decision);

        return ResolveMcpPendingDecisionResponse.resolved(
                completed.id(),
                completed.runId(),
                result == null ? null : result.model(),
                result == null || result.stopReason() == null ? null : result.stopReason().name(),
                completed.decision()
        );
    }

    private McpSchema.CreateMessageRequest buildSamplingRequest(McpPendingDecision pendingDecision) {
        McpDecisionGatewayCommand command = pendingDecision.command();
        String observationJson;
        try {
            observationJson = objectMapper.writeValueAsString(command);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(
                    ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE,
                    "Failed to serialize MCP pending decision observation."
            );
        }

        String prompt = """
                Decide the next Wedge Runner action for this pending decision.
                Return only AgentDecision JSON. Do not include markdown.
                The JSON object must contain:
                kind, actionType, targetKey, stage, reason, confidence.
                For click actions, targetKey must be one of page.candidates[].targetKey.
                Do not invent selectors, credentials, payment data, JavaScript, shell commands, cookies, or storage values.

                Pending decision:
                %s
                """.formatted(observationJson);

        return McpSchema.CreateMessageRequest.builder()
                .systemPrompt("You are a Wedge MCP decision resolver. Return only strict AgentDecision JSON.")
                .includeContext(McpSchema.CreateMessageRequest.ContextInclusionStrategy.NONE)
                .temperature(0.0)
                .maxTokens(700)
                .messages(List.of(new McpSchema.SamplingMessage(
                        McpSchema.Role.USER,
                        new McpSchema.TextContent(prompt)
                )))
                .build();
    }

    private String extractText(McpSchema.CreateMessageResult result) {
        if (result == null || !(result.content() instanceof McpSchema.TextContent textContent)) {
            throw new BusinessException(
                    ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE,
                    "MCP sampling result did not contain text content."
            );
        }
        return textContent.text();
    }

    private Map<String, Object> parseDecision(String rawDecision) {
        if (isBlank(rawDecision)) {
            throw new BusinessException(
                    ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE,
                    "MCP sampling result was empty."
            );
        }

        try {
            Map<String, Object> parsed = objectMapper.readValue(rawDecision, MAP_TYPE);
            Object wrappedDecision = parsed.get("decision");
            if (wrappedDecision instanceof Map<?, ?> map) {
                return normalizeMap(map);
            }
            return parsed;
        } catch (JsonProcessingException exception) {
            throw new BusinessException(
                    ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE,
                    "MCP sampling result was not valid AgentDecision JSON."
            );
        }
    }

    private Map<String, Object> normalizeMap(Map<?, ?> source) {
        Map<String, Object> normalized = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : source.entrySet()) {
            if (entry.getKey() instanceof String key) {
                normalized.put(key, entry.getValue());
            }
        }
        return normalized;
    }

    private void validateDecision(Map<String, Object> decision, McpDecisionGatewayCommand command) {
        String kind = lowerString(decision.get("kind"));
        if (!ALLOWED_KINDS.contains(kind)) {
            throw invalidDecision("kind must be act, checkpoint, or finish.");
        }

        String reason = string(decision.get("reason"));
        if (isBlank(reason) || reason.length() > MAX_REASON_LENGTH) {
            throw invalidDecision("reason is required and must be at most 500 characters.");
        }

        double confidence = number(decision.get("confidence"));
        if (confidence < 0.0 || confidence > 1.0) {
            throw invalidDecision("confidence must be between 0.0 and 1.0.");
        }

        String actionType = lowerString(decision.get("actionType"));
        if ("checkpoint".equals(kind) || "finish".equals(kind)) {
            if (!isBlank(actionType) && !"checkpoint".equals(actionType)) {
                throw invalidDecision("checkpoint or finish decisions must use checkpoint actionType.");
            }
        } else if (!command.allowedActions().contains(actionType)) {
            throw invalidDecision("actionType must be one of the pending decision allowedActions.");
        }

        if ("click".equals(actionType)) {
            String targetKey = string(decision.get("targetKey"));
            boolean targetAllowed = command.page().candidates().stream()
                    .anyMatch(candidate -> candidate.targetKey().equals(targetKey));
            if (!targetAllowed) {
                throw invalidDecision("click targetKey must match an observed candidate.");
            }
        }

        if (containsForbiddenText(decision)) {
            throw invalidDecision("AgentDecision contains forbidden raw execution or secret-like text.");
        }
    }

    private BusinessException invalidDecision(String message) {
        return new BusinessException(ErrorCode.MCP_SAMPLING_BRIDGE_UNAVAILABLE, message);
    }

    private boolean containsForbiddenText(Map<String, Object> decision) {
        String combined = decision.values().stream()
                .filter(value -> value instanceof String)
                .map(value -> ((String) value).toLowerCase(Locale.ROOT))
                .collect(java.util.stream.Collectors.joining(" "));
        return FORBIDDEN_TEXT_MARKERS.stream().anyMatch(combined::contains);
    }

    private String lowerString(Object value) {
        String stringValue = string(value);
        return stringValue == null ? null : stringValue.toLowerCase(Locale.ROOT);
    }

    private String string(Object value) {
        return value instanceof String stringValue ? stringValue : null;
    }

    private double number(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        throw invalidDecision("confidence must be a number.");
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
