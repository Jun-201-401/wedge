package com.wedge.report.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.report.api.dto.DecisionMapItemResponse;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ReportJsonReader {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };
    private static final TypeReference<List<Object>> LIST_TYPE = new TypeReference<>() {
    };

    private final ObjectMapper objectMapper;

    public Map<String, Object> readObject(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        JsonNode node = readTree(json);
        if (!node.isObject()) {
            throw invalidStoredJson("Stored report JSON object is invalid.");
        }
        return objectMapper.convertValue(node, MAP_TYPE);
    }

    public List<Object> readArray(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        JsonNode node = readTree(json);
        if (!node.isArray()) {
            throw invalidStoredJson("Stored report JSON array is invalid.");
        }
        return objectMapper.convertValue(node, LIST_TYPE);
    }

    public List<DecisionMapItemResponse> readDecisionMap(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        JsonNode node = readTree(json);
        if (!node.isArray()) {
            throw invalidStoredJson("Stored decision map JSON is invalid.");
        }
        List<DecisionMapItemResponse> items = new ArrayList<>();
        node.forEach(item -> items.add(toDecisionMapItem(item)));
        return items;
    }

    public BigDecimal readFrictionScore(Map<String, Object> summary) {
        Object value = summary.get("friction_score");
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
            return BigDecimal.valueOf(((Number) value).longValue());
        }
        if (value instanceof Float || value instanceof Double) {
            return BigDecimal.valueOf(((Number) value).doubleValue());
        }
        return null;
    }

    private JsonNode readTree(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (JsonProcessingException exception) {
            throw invalidStoredJson("Stored report JSON is invalid.", exception);
        }
    }

    private DecisionMapItemResponse toDecisionMapItem(JsonNode item) {
        if (!item.isObject() || !hasRequiredDecisionMapFields(item)) {
            throw invalidStoredJson("Stored decision map item JSON is invalid.");
        }
        return new DecisionMapItemResponse(
                text(item, "stage"),
                text(item, "displayName"),
                text(item, "status"),
                textArray(item, "issueIds"),
                nullableText(item, "summary"),
                textArray(item, "evidenceRefs")
        );
    }

    private boolean hasRequiredDecisionMapFields(JsonNode item) {
        return item.hasNonNull("stage")
                && item.hasNonNull("displayName")
                && item.hasNonNull("status")
                && item.has("issueIds")
                && item.has("evidenceRefs");
    }

    private String text(JsonNode item, String field) {
        JsonNode value = item.get(field);
        if (value == null || !value.isTextual()) {
            throw invalidStoredJson("Stored decision map item JSON is invalid.");
        }
        return value.asText();
    }

    private String nullableText(JsonNode item, String field) {
        JsonNode value = item.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw invalidStoredJson("Stored decision map item JSON is invalid.");
        }
        return value.asText();
    }

    private List<String> textArray(JsonNode item, String field) {
        JsonNode value = item.get(field);
        if (value == null || !value.isArray()) {
            throw invalidStoredJson("Stored decision map item JSON is invalid.");
        }
        List<String> values = new ArrayList<>();
        value.forEach(element -> values.add(textElement(element)));
        return values;
    }

    private String textElement(JsonNode element) {
        if (!element.isTextual()) {
            throw invalidStoredJson("Stored decision map item JSON is invalid.");
        }
        return element.asText();
    }

    private BusinessException invalidStoredJson(String message) {
        return invalidStoredJson(message, null);
    }

    private BusinessException invalidStoredJson(String message, Throwable cause) {
        return new BusinessException(ErrorCode.INTERNAL_ERROR, message, null, cause);
    }
}
