package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wedge.common.error.BusinessException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ScenarioPlanValidatorTest {
    private final ScenarioPlanValidator validator = new ScenarioPlanValidator();

    @Test
    void validateScenarioPlanAcceptsFixedShortSettleStrategy() {
        Map<String, Object> plan = validPlan();
        firstStep(plan).put("settle_strategy", Map.of("type", "fixed_short", "timeout_ms", 1000));

        assertThatCode(() -> validator.validateScenarioPlan(plan, URI.create("https://example.com"), "desktop"))
                .doesNotThrowAnyException();
    }

    @Test
    void validateScenarioPlanRejectsNoWaitSettleStrategy() {
        Map<String, Object> plan = validPlan();
        firstStep(plan).put("settle_strategy", Map.of("type", "no_wait", "timeout_ms", 0));

        assertThatThrownBy(() -> validator.validateScenarioPlan(plan, URI.create("https://example.com"), "desktop"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("unsupported: no_wait");
    }

    @Test
    void validateScenarioPlanRejectsNegativeAndFractionalTimeouts() {
        Map<String, Object> negative = validPlan();
        firstStep(negative).put("settle_strategy", Map.of("type", "none", "timeout_ms", -1));
        assertThatThrownBy(() -> validator.validateScenarioPlan(negative, URI.create("https://example.com"), "desktop"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("greater than or equal to 0");

        Map<String, Object> fractional = validPlan();
        firstStep(fractional).put("settle_strategy", Map.of("type", "none", "timeout_ms", 0.5));
        assertThatThrownBy(() -> validator.validateScenarioPlan(fractional, URI.create("https://example.com"), "desktop"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("integer");
    }

    @Test
    void validateScenarioPlanRejectsUnsupportedFitRequirementFlowType() {
        Map<String, Object> plan = validPlan();
        plan.put("fit_requirements", Map.of(
                "required_flow_type", "CUSTOM_GUIDED",
                "required_entrypoint_types", List.of("cta"),
                "fallback_allowed", true
        ));

        assertThatThrownBy(() -> validator.validateScenarioPlan(plan, URI.create("https://example.com"), "desktop"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("required_flow_type");
    }


    @Test
    void validateScenarioPlanAcceptsAllowedExternalOriginsSafetyField() {
        Map<String, Object> plan = validPlan();
        plan.put("safety", Map.of(
                "allow_external_navigation", true,
                "allowed_external_origins", List.of("https://checkout.example.com"),
                "allow_payment_commit", false,
                "allow_destructive_action", false,
                "use_synthetic_inputs", true,
                "stop_before_real_payment", true
        ));

        assertThatCode(() -> validator.validateScenarioPlan(plan, URI.create("https://example.com"), "desktop"))
                .doesNotThrowAnyException();
    }

    @Test
    void validateScenarioPlanAcceptsStopWhenWithTopLevelStopCondition() {
        Map<String, Object> plan = validPlan();
        plan.put("steps", List.of(firstStep(plan), stopStep(true)));

        assertThatCode(() -> validator.validateScenarioPlan(plan, URI.create("https://example.com"), "desktop"))
                .doesNotThrowAnyException();
    }

    @Test
    void validateScenarioPlanRejectsStopWhenWithoutTopLevelStopCondition() {
        Map<String, Object> plan = validPlan();
        plan.put("steps", List.of(firstStep(plan), stopStep(false)));

        assertThatThrownBy(() -> validator.validateScenarioPlan(plan, URI.create("https://example.com"), "desktop"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("stop_condition");
    }

    private Map<String, Object> validPlan() {
        return new LinkedHashMap<>(Map.of(
                "schema_version", "0.5",
                "plan_id", "plan_001",
                "scenario_type", "custom_compiled",
                "goal", "무료 체험 CTA까지의 흐름 점검",
                "start_url", "https://example.com",
                "environment", Map.of(
                        "device", "desktop",
                        "viewport", Map.of("width", 1440, "height", 900),
                        "locale", "ko-KR",
                        "timezone", "Asia/Seoul",
                        "auth_state", "anonymous"
                ),
                "safety", Map.of(
                        "allow_external_navigation", false,
                        "allow_payment_commit", false,
                        "allow_destructive_action", false,
                        "use_synthetic_inputs", true
                ),
                "fit_requirements", Map.of(
                        "required_flow_type", "LANDING_CTA",
                        "required_entrypoint_types", List.of("cta"),
                        "fallback_allowed", true
                ),
                "steps", List.of(new LinkedHashMap<>(Map.of(
                        "step_id", "step_001_goto",
                        "stage", "FIRST_VIEW",
                        "description", "랜딩 첫 화면 로드",
                        "action", Map.of("type", "goto", "target", "https://example.com"),
                        "settle_strategy", Map.of("type", "network_idle", "timeout_ms", 1000),
                        "checkpoint", true
                )))
        ));
    }

    private Map<String, Object> stopStep(boolean includeStopCondition) {
        Map<String, Object> step = new LinkedHashMap<>(Map.of(
                "step_id", "step_002_stop_before_submit",
                "stage", "COMMIT",
                "description", "제출 직전에 중단",
                "action", Map.of("type", "stop_when"),
                "settle_strategy", Map.of("type", "none", "timeout_ms", 0),
                "checkpoint", false
        ));
        if (includeStopCondition) {
            step.put("stop_condition", Map.of("condition", "before_real_submit"));
        }
        return step;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> firstStep(Map<String, Object> plan) {
        return (Map<String, Object>) ((List<?>) plan.get("steps")).get(0);
    }
}
