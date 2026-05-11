package com.wedge.run.application;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class AgentReplayHintsFactory {
    private static final List<String> UNSAFE_REPLAY_KEYWORDS = List.of(
            "pay now",
            "submit payment",
            "complete payment",
            "confirm payment",
            "final payment",
            "place order",
            "submit order",
            "complete order",
            "confirm order",
            "delete account",
            "remove account",
            "결제 완료",
            "최종 결제",
            "결제 확정",
            "주문 완료",
            "주문 확정",
            "구매 확정",
            "회원 탈퇴",
            "계정 삭제"
    );

    public Optional<Map<String, Object>> create(Map<String, Object> trace) {
        String traceId = stringValue(trace.get("trace_id"));
        if (traceId == null) {
            return Optional.empty();
        }

        List<String> completedDecisionIds = completedDecisionIds(trace);
        List<Map<String, Object>> steps = new ArrayList<>();
        for (Object value : listValue(trace.get("decisions"))) {
            if (!(value instanceof Map<?, ?> rawDecision)) {
                continue;
            }
            Map<String, Object> decision = castMap(rawDecision);
            String decisionId = stringValue(decision.get("decision_id"));
            if (decisionId == null || !completedDecisionIds.contains(decisionId)) {
                continue;
            }

            Object actionValue = decision.get("action");
            if (!(actionValue instanceof Map<?, ?> rawActionRecord)) {
                continue;
            }
            Map<String, Object> actionRecord = castMap(rawActionRecord);
            String tool = stringValue(actionRecord.get("tool"));
            if (tool == null || "checkpoint".equals(tool) || "stop_when".equals(tool)) {
                continue;
            }

            Map<String, Object> action = toScenarioAction(tool, actionRecord);
            if (isUnsafeReplayAction(action)) {
                continue;
            }

            steps.add(toReplayHintStep(steps.size() + 1, decision, actionRecord, action));
        }

        if (steps.isEmpty()) {
            return Optional.empty();
        }

        Map<String, Object> replayHints = new LinkedHashMap<>();
        replayHints.put("source_trace_id", traceId);
        replayHints.put("source_plan_id", "agent-trace-replay-" + traceId);
        replayHints.put("steps", steps);
        return Optional.of(replayHints);
    }

    private List<String> completedDecisionIds(Map<String, Object> trace) {
        List<String> decisionIds = new ArrayList<>();
        for (Object value : listValue(trace.get("events"))) {
            if (!(value instanceof Map<?, ?> rawEvent)) {
                continue;
            }
            Map<String, Object> event = castMap(rawEvent);
            if (!"AGENT_ACTION_COMPLETED".equals(stringValue(event.get("event_type")))) {
                continue;
            }
            Object payloadValue = event.get("payload");
            if (!(payloadValue instanceof Map<?, ?> rawPayload)) {
                continue;
            }
            String decisionId = stringValue(castMap(rawPayload).get("decision_id"));
            if (decisionId != null) {
                decisionIds.add(decisionId);
            }
        }
        return decisionIds;
    }

    private Map<String, Object> toReplayHintStep(
            int index,
            Map<String, Object> decision,
            Map<String, Object> actionRecord,
            Map<String, Object> action
    ) {
        Map<String, Object> step = new LinkedHashMap<>();
        String actionType = stringValue(action.get("type"));
        step.put("step_id", "agent_replay_" + String.format("%03d", index));
        step.put("stage", Optional.ofNullable(stringValue(decision.get("stage"))).orElse(defaultStage(actionType)));
        step.put("description", replayDescription(decision, index));
        step.put("action", action);
        step.put("settle_strategy", defaultSettleStrategy(actionType));
        String targetKey = stringValue(actionRecord.get("target_key"));
        if (targetKey != null) {
            step.put("target_key", targetKey);
        }
        Object confidence = decision.get("confidence");
        if (confidence instanceof Number number && number.doubleValue() >= 0 && number.doubleValue() <= 1) {
            step.put("confidence", number.doubleValue());
        }
        return step;
    }

    private Map<String, Object> toScenarioAction(String tool, Map<String, Object> actionRecord) {
        Map<String, Object> action = new LinkedHashMap<>();
        action.put("type", tool);
        Object target = actionRecord.get("target");
        if (target != null) {
            action.put("target", target);
        } else {
            String targetKey = stringValue(actionRecord.get("target_key"));
            if (targetKey != null) {
                action.put("target", Map.of("selector", targetKey));
            }
        }
        Object value = actionRecord.get("value");
        if (value != null) {
            action.put("value", value);
        }
        Object options = actionRecord.get("options");
        if (options instanceof Map<?, ?> rawOptions && !rawOptions.isEmpty()) {
            action.put("options", castMap(rawOptions));
        }
        return action;
    }

    private boolean isUnsafeReplayAction(Map<String, Object> action) {
        String type = stringValue(action.get("type"));
        if (!("click".equals(type) || "fill".equals(type) || "select".equals(type))) {
            return false;
        }
        String actionText = action.toString().toLowerCase(Locale.ROOT);
        return UNSAFE_REPLAY_KEYWORDS.stream().anyMatch(actionText::contains);
    }

    private String replayDescription(Map<String, Object> decision, int index) {
        String reason = stringValue(decision.get("reason"));
        return reason == null || reason.isBlank()
                ? "Replay AgentTrace decision " + index
                : "Replay AgentTrace decision " + index + ": " + reason;
    }

    private Map<String, Object> defaultSettleStrategy(String actionType) {
        if ("goto".equals(actionType)) {
            return Map.of("type", "network_idle", "timeout_ms", 1_000);
        }
        if ("scroll".equals(actionType)) {
            return Map.of("type", "fixed_short", "timeout_ms", 250);
        }
        return Map.of("type", "fixed_short", "timeout_ms", 500);
    }

    private String defaultStage(String actionType) {
        if ("goto".equals(actionType)) {
            return "FIRST_VIEW";
        }
        if ("fill".equals(actionType) || "select".equals(actionType)) {
            return "INPUT";
        }
        if ("scroll".equals(actionType)) {
            return "VALUE";
        }
        return "CTA";
    }

    private List<?> listValue(Object value) {
        return value instanceof List<?> list ? list : List.of();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Map<?, ?> value) {
        return (Map<String, Object>) value;
    }

    private String stringValue(Object value) {
        return value instanceof String text && !text.isBlank() ? text : null;
    }
}
