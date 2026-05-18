package com.wedge.analysis.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class JudgeResultContractValidator {
    private static final String SUPPORTED_SCHEMA_VERSION = "0.5";
    private static final Set<String> VALID_STAGES = Set.of("FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT");
    private static final Set<String> VALID_RISK_LEVELS = Set.of("low", "medium", "high", "critical");
    private static final Set<String> VALID_TASK_SUCCESS = Set.of("success", "partial", "failed", "blocked");
    private static final Set<String> VALID_STAGE_STATUSES = Set.of("PASS", "WARNING", "BLOCKED", "NOT_OBSERVED", "NOT_APPLICABLE");

    public void validate(Map<String, Object> judgeResult) {
        requireString(judgeResult, "schema_version");
        if (!SUPPORTED_SCHEMA_VERSION.equals(judgeResult.get("schema_version"))) {
            throw invalid("JudgeResult schema_version is not supported.");
        }
        requireString(judgeResult, "run_id");
        requireString(judgeResult, "evidence_schema_version");
        requireString(judgeResult, "rule_registry_id");
        validateSummary(requireMap(judgeResult, "summary"));
        validateIssues(requireList(judgeResult, "issues"));
        validateDecisionMap(requireList(judgeResult, "decision_map"));
    }

    private void validateSummary(Map<String, Object> summary) {
        requireEnum(summary, "overall_risk", VALID_RISK_LEVELS);
        requireNumber(summary, "friction_score");
        requireInteger(summary, "top_issues_count");
        requireEnum(summary, "task_success", VALID_TASK_SUCCESS);
    }

    private void validateIssues(List<Object> issues) {
        for (Object item : issues) {
            Map<String, Object> issue = requireObject(item, "JudgeResult issues item must be an object.");
            requireString(issue, "issue_id");
            requireString(issue, "criterion_id");
            requireEnum(issue, "stage", VALID_STAGES);
            requireString(issue, "axis");
            requireInteger(issue, "severity");
            requireNumber(issue, "confidence");
            requireNumber(issue, "priority_score");
            requireList(issue, "evidence_refs");
            requireString(issue, "summary");
            requireList(issue, "recommendations");
        }
    }

    private void validateDecisionMap(List<Object> decisionMap) {
        for (Object item : decisionMap) {
            Map<String, Object> decision = requireObject(item, "JudgeResult decision_map item must be an object.");
            requireEnum(decision, "stage", VALID_STAGES);
            requireString(decision, "displayName");
            requireEnum(decision, "status", VALID_STAGE_STATUSES);
            requireList(decision, "issueIds");
            if (!decision.containsKey("summary")) {
                throw invalid("JudgeResult decision_map.summary is required.");
            }
            Object summary = decision.get("summary");
            if (summary != null && !(summary instanceof String)) {
                throw invalid("JudgeResult decision_map.summary must be a string or null.");
            }
            requireList(decision, "evidenceRefs");
        }
    }

    private Map<String, Object> requireMap(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((mapKey, mapValue) -> result.put(String.valueOf(mapKey), mapValue));
            return result;
        }
        throw invalid("JudgeResult " + key + " is required.");
    }

    private Map<String, Object> requireObject(Object value, String message) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((mapKey, mapValue) -> result.put(String.valueOf(mapKey), mapValue));
            return result;
        }
        throw invalid(message);
    }

    private List<Object> requireList(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (value instanceof List<?> list) {
            return List.copyOf(list);
        }
        throw invalid("JudgeResult " + key + " is required.");
    }

    private String requireString(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw invalid("JudgeResult " + key + " is required.");
    }

    private void requireEnum(Map<String, Object> payload, String key, Set<String> validValues) {
        String value = requireString(payload, key);
        if (!validValues.contains(value)) {
            throw invalid("JudgeResult " + key + " is invalid.");
        }
    }

    private void requireNumber(Map<String, Object> payload, String key) {
        if (!(payload.get(key) instanceof Number)) {
            throw invalid("JudgeResult " + key + " is required.");
        }
    }

    private void requireInteger(Map<String, Object> payload, String key) {
        Number number = payload.get(key) instanceof Number value ? value : null;
        if (number == null || number.doubleValue() % 1 != 0) {
            throw invalid("JudgeResult " + key + " is required.");
        }
    }

    private BusinessException invalid(String message) {
        return new BusinessException(ErrorCode.INVALID_REQUEST, message);
    }
}

