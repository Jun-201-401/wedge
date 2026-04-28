package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ScenarioPlanValidator {
    public void validateCreateRequest(RunCreateRequest request) {
        Map<String, Object> scenarioPlan = request.scenarioPlan();
        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan is required.");
        }

        requireNonBlankString(scenarioPlan, "schema_version");
        requireNonBlankString(scenarioPlan, "plan_id");
        requireNonBlankString(scenarioPlan, "scenario_type");

        String planStartUrl = requireNonBlankString(scenarioPlan, "start_url");
        if (!request.startUrl().toString().equals(planStartUrl)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.start_url must match startUrl.");
        }

        Map<String, Object> environment = requireMap(scenarioPlan, "environment");
        String planDevice = requireNonBlankString(environment, "device");
        if (!request.devicePreset().equals(planDevice)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.environment.device must match devicePreset.");
        }

        Object steps = scenarioPlan.get("steps");
        if (!(steps instanceof List<?> stepList) || stepList.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps must contain at least one step.");
        }
    }

    private Map<String, Object> requireMap(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof Map<?, ?> rawMap) {
            @SuppressWarnings("unchecked")
            Map<String, Object> mapValue = (Map<String, Object>) rawMap;
            return mapValue;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan." + key + " must be an object.");
    }

    private String requireNonBlankString(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan." + key + " is required.");
    }
}
