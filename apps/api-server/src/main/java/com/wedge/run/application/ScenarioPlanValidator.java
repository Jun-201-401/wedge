package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.api.dto.RunCreateRequest;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class ScenarioPlanValidator {
    private static final Set<String> SCENARIO_TYPES = Set.of("template", "custom_compiled");
    private static final Set<String> FLOW_TYPES = Set.of("LANDING_CTA", "SIGNUP_LEAD_FORM", "PRICING", "PURCHASE_CHECKOUT", "CONTACT", "CONTENT_ONLY");
    private static final Set<String> ENTRYPOINT_TYPES = Set.of("cta", "form", "pricing", "checkout", "cart", "signup", "contact", "content");
    private static final Set<String> DEVICES = Set.of("desktop", "mobile", "tablet");
    private static final Set<String> AUTH_STATES = Set.of("anonymous", "test_account", "stored_state");
    private static final Set<String> STAGES = Set.of("FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT");
    private static final Set<String> ACTION_TYPES = Set.of("goto", "click", "fill", "select", "scroll", "hover", "wait_for", "checkpoint", "stop_when");
    private static final Set<String> ACTION_KEYS = Set.of("type", "target", "value", "options");
    private static final Set<String> SETTLE_TYPES = Set.of("network_idle", "locator_visible", "response", "url_change", "spinner_hidden", "item_count_change", "fixed_short", "none");
    private static final Set<String> SAFETY_KEYS = Set.of("allow_external_navigation", "allow_payment_commit", "allow_destructive_action", "use_synthetic_inputs", "stop_before_real_payment");
    private static final Set<String> FIT_REQUIREMENT_KEYS = Set.of("required_flow_type", "required_entrypoint_types", "fallback_allowed", "minimum_confidence", "required_evidence_refs");
    private static final Set<String> STEP_KEYS = Set.of("step_id", "stage", "description", "action", "settle_strategy", "checkpoint", "stop_condition");

    public void validateCreateRequest(RunCreateRequest request) {
        validateScenarioPlan(request.scenarioPlan(), request.startUrl(), request.devicePreset());
    }

    public void validateScenarioPlan(Map<String, Object> scenarioPlan, URI startUrl, String devicePreset) {
        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan is required.");
        }

        requireConst(scenarioPlan, "schema_version", "0.5");
        requireNonBlankString(scenarioPlan, "plan_id");
        requireEnum(scenarioPlan, "scenario_type", SCENARIO_TYPES);
        requireNonBlankString(scenarioPlan, "goal");

        String planStartUrl = requireNonBlankString(scenarioPlan, "start_url");
        if (!startUrl.toString().equals(planStartUrl)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.start_url must match startUrl.");
        }
        if (!isAbsoluteUri(planStartUrl)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.start_url must be an absolute URI.");
        }

        Map<String, Object> environment = validateEnvironment(requireMap(scenarioPlan, "environment"));
        String planDevice = requireEnum(environment, "device", DEVICES);
        if (!devicePreset.equals(planDevice)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.environment.device must match devicePreset.");
        }

        validateSafety(requireMap(scenarioPlan, "safety"));
        validateFitRequirements(scenarioPlan.get("fit_requirements"));

        Object steps = scenarioPlan.get("steps");
        if (!(steps instanceof List<?> stepList) || stepList.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps must contain at least one step.");
        }
        for (Object step : stepList) {
            if (!(step instanceof Map<?, ?> rawStep)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps items must be objects.");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> stepMap = (Map<String, Object>) rawStep;
            validateStep(stepMap);
        }
    }

    private void validateStep(Map<String, Object> step) {
        for (String key : step.keySet()) {
            if (!STEP_KEYS.contains(key)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps[] contains unsupported field: " + key);
            }
        }
        requireNonBlankString(step, "step_id");
        requireEnum(step, "stage", STAGES);
        requireNonBlankString(step, "description");
        String actionType = validateAction(requireMap(step, "action"));
        if ("stop_when".equals(actionType)) {
            requireMap(step, "stop_condition");
        }
        validateSettleStrategy(requireMap(step, "settle_strategy"));
        if (!(step.get("checkpoint") instanceof Boolean)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps[].checkpoint must be a boolean.");
        }
    }

    private String validateAction(Map<String, Object> action) {
        String actionType = requireEnum(action, "type", ACTION_TYPES);
        for (String key : action.keySet()) {
            if (!ACTION_KEYS.contains(key)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps[].action contains unsupported field: " + key);
            }
        }
        return actionType;
    }

    private void validateSettleStrategy(Map<String, Object> settleStrategy) {
        requireEnum(settleStrategy, "type", SETTLE_TYPES);
        int timeoutMs = requireInteger(settleStrategy, "timeout_ms", "scenarioPlan.steps[].settle_strategy.timeout_ms");
        if (timeoutMs < 0) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.steps[].settle_strategy.timeout_ms must be greater than or equal to 0.");
        }
        validateOptionalIntegerRange(settleStrategy, "status", 100, 599, "scenarioPlan.steps[].settle_strategy.status");
        validateOptionalIntegerMin(settleStrategy, "expected_count", 0, "scenarioPlan.steps[].settle_strategy.expected_count");
        validateOptionalIntegerMin(settleStrategy, "min_count", 0, "scenarioPlan.steps[].settle_strategy.min_count");
        validateOptionalIntegerMin(settleStrategy, "max_count", 0, "scenarioPlan.steps[].settle_strategy.max_count");
        validateOptionalInteger(settleStrategy, "count_delta", "scenarioPlan.steps[].settle_strategy.count_delta");
    }

    private Map<String, Object> validateEnvironment(Map<String, Object> environment) {
        requireEnum(environment, "device", DEVICES);
        Map<String, Object> viewport = requireMap(environment, "viewport");
        if (requireInteger(viewport, "width", "scenarioPlan.environment.viewport.width") < 320) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.environment.viewport.width must be at least 320.");
        }
        if (requireInteger(viewport, "height", "scenarioPlan.environment.viewport.height") < 480) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.environment.viewport.height must be at least 480.");
        }
        requireNonBlankString(environment, "locale");
        requireNonBlankString(environment, "timezone");
        requireEnum(environment, "auth_state", AUTH_STATES);
        return environment;
    }

    private void validateSafety(Map<String, Object> safety) {
        for (String requiredKey : List.of("allow_external_navigation", "allow_payment_commit", "allow_destructive_action", "use_synthetic_inputs")) {
            if (!(safety.get(requiredKey) instanceof Boolean)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.safety." + requiredKey + " must be a boolean.");
            }
        }
        for (String key : safety.keySet()) {
            if (!SAFETY_KEYS.contains(key)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.safety contains unsupported field: " + key);
            }
        }
    }

    private void validateFitRequirements(Object value) {
        if (value == null) {
            return;
        }
        if (!(value instanceof Map<?, ?> rawMap)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements must be an object.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> fitRequirements = (Map<String, Object>) rawMap;
        for (String key : fitRequirements.keySet()) {
            if (!FIT_REQUIREMENT_KEYS.contains(key)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements contains unsupported field: " + key);
            }
        }
        requireEnum(fitRequirements, "required_flow_type", FLOW_TYPES);
        if (!(fitRequirements.get("required_entrypoint_types") instanceof List<?> entrypoints)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements.required_entrypoint_types must be an array.");
        }
        for (Object entrypoint : entrypoints) {
            if (!(entrypoint instanceof String text) || !ENTRYPOINT_TYPES.contains(text)) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements.required_entrypoint_types contains unsupported value: " + entrypoint);
            }
        }
        if (!(fitRequirements.get("fallback_allowed") instanceof Boolean)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements.fallback_allowed must be a boolean.");
        }
        Object confidence = fitRequirements.get("minimum_confidence");
        if (confidence != null) {
            if (!(confidence instanceof Number number) || number.doubleValue() < 0 || number.doubleValue() > 1) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements.minimum_confidence must be between 0 and 1.");
            }
        }
        Object evidenceRefs = fitRequirements.get("required_evidence_refs");
        if (evidenceRefs != null) {
            if (!(evidenceRefs instanceof List<?> refs) || refs.stream().anyMatch(item -> !(item instanceof String))) {
                throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan.fit_requirements.required_evidence_refs must be an array of strings.");
            }
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

    private String requireEnum(Map<String, Object> source, String key, Set<String> allowedValues) {
        String value = requireNonBlankString(source, key);
        if (allowedValues.contains(value)) {
            return value;
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan." + key + " is unsupported: " + value);
    }

    private void requireConst(Map<String, Object> source, String key, String expectedValue) {
        String value = requireNonBlankString(source, key);
        if (!expectedValue.equals(value)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "scenarioPlan." + key + " must be " + expectedValue + ".");
        }
    }

    private int requireInteger(Map<String, Object> source, String key, String path) {
        Object value = source.get(key);
        if (value instanceof Integer integer) {
            return integer;
        }
        if (value instanceof Long longValue && longValue >= Integer.MIN_VALUE && longValue <= Integer.MAX_VALUE) {
            return longValue.intValue();
        }
        throw new BusinessException(ErrorCode.INVALID_REQUEST, path + " must be an integer.");
    }

    private void validateOptionalInteger(Map<String, Object> source, String key, String path) {
        if (source.containsKey(key)) {
            requireInteger(source, key, path);
        }
    }

    private void validateOptionalIntegerMin(Map<String, Object> source, String key, int minimum, String path) {
        if (source.containsKey(key) && requireInteger(source, key, path) < minimum) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, path + " must be at least " + minimum + ".");
        }
    }

    private void validateOptionalIntegerRange(Map<String, Object> source, String key, int minimum, int maximum, String path) {
        if (!source.containsKey(key)) {
            return;
        }
        int value = requireInteger(source, key, path);
        if (value < minimum || value > maximum) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, path + " must be between " + minimum + " and " + maximum + ".");
        }
    }

    private boolean isAbsoluteUri(String value) {
        try {
            return URI.create(value).isAbsolute();
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
