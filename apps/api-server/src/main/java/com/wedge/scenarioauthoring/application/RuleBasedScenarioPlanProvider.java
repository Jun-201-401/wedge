package com.wedge.scenarioauthoring.application;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RuleBasedScenarioPlanProvider {
    public List<Map<String, Object>> createCandidates(
            UUID authoringJobId,
            UUID sourceDiscoveryId,
            String requestedGoal,
            Map<String, Object> input,
            Map<String, Object> selectedRecommendation,
            ScenarioPlanCandidateValidator validator
    ) {
        String scenarioType = readString(selectedRecommendation, "scenarioType", "scenario_type", "LANDING_CTA");
        String startUrl = readString(selectedRecommendation, "suggestedStartUrl", "suggested_start_url", "");
        if (startUrl.isBlank()) {
            startUrl = readSiteDiscoveryString(input, "final_url");
        }
        if (startUrl.isBlank()) {
            startUrl = readSiteDiscoveryString(input, "input_url");
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> environment = input.get("environment") instanceof Map<?, ?> rawEnvironment
                ? (Map<String, Object>) rawEnvironment
                : Map.of(
                        "device", "desktop",
                        "viewport", Map.of("width", 1440, "height", 900),
                        "locale", "ko-KR",
                        "timezone", "Asia/Seoul",
                        "auth_state", "anonymous"
                );
        Map<String, Object> safety = Map.of(
                "allow_external_navigation", false,
                "allow_payment_commit", false,
                "allow_destructive_action", false,
                "use_synthetic_inputs", true,
                "stop_before_real_payment", true
        );
        List<String> evidenceRefs = readStringList(selectedRecommendation.get("evidenceRefs"), selectedRecommendation.get("evidence_refs"));
        String candidateId = "rule_based_" + scenarioType.toLowerCase() + "_001";
        Map<String, Object> scenarioPlan = Map.of(
                "schema_version", "0.5",
                "plan_id", authoringJobId + "_" + candidateId,
                "scenario_type", "custom_compiled",
                "source_discovery_id", sourceDiscoveryId.toString(),
                "goal", requestedGoal,
                "start_url", startUrl,
                "environment", environment,
                "safety", safety,
                "fit_requirements", Map.of(
                        "required_flow_type", scenarioType,
                        "required_entrypoint_types", requiredEntrypoints(scenarioType),
                        "fallback_allowed", true,
                        "minimum_confidence", 0.5,
                        "required_evidence_refs", evidenceRefs
                ),
                "steps", stepsFor(scenarioType, startUrl, selectedRecommendation)
        );
        Map<String, Object> validation = validator.validate(scenarioPlan, startUrl, String.valueOf(environment.get("device")));
        return List.of(Map.of(
                "candidate_id", candidateId,
                "scenario_plan", scenarioPlan,
                "confidence", selectedRecommendation.getOrDefault("confidence", 0.72),
                "rationale", "RULE_BASED provider compiled a conservative " + scenarioType + " ScenarioPlan candidate from the selected Discovery recommendation.",
                "evidence_refs", evidenceRefs,
                "source_recommendation_refs", List.of(sourceDiscoveryId + ".recommendation." + scenarioType),
                "validation", validation
        ));
    }

    private List<Map<String, Object>> stepsFor(String scenarioType, String startUrl, Map<String, Object> selectedRecommendation) {
        List<Map<String, Object>> steps = new ArrayList<>();
        steps.add(step("step_001_goto", "FIRST_VIEW", "Discovery 추천 URL에 진입한다.", Map.of("type", "goto", "target", startUrl), "network_idle", true));
        steps.add(step("step_002_first_view_checkpoint", "FIRST_VIEW", "첫 화면의 핵심 문맥과 진입점을 기록한다.", Map.of("type", "checkpoint"), "none", true));

        Object suggestedTarget = selectedRecommendation.getOrDefault("suggestedTarget", selectedRecommendation.get("suggested_target"));
        if (suggestedTarget instanceof Map<?, ?> target && !target.isEmpty() && !scenarioType.equals("CONTENT_ONLY")) {
            steps.add(step("step_003_probe_recommended_target", stageFor(scenarioType), "추천된 진입점을 클릭해 다음 의사결정 지점으로 이동한다.", Map.of("type", "click", "target", target), "network_idle", false));
            steps.add(step("step_004_destination_checkpoint", stageFor(scenarioType), "이동 후 도착 지점의 문맥을 기록한다.", Map.of("type", "checkpoint"), "none", true));
        } else {
            steps.add(step("step_003_context_checkpoint", stageFor(scenarioType), "추천 흐름을 실행하기 전 현재 문맥을 기록한다.", Map.of("type", "checkpoint"), "none", true));
        }

        if (scenarioType.equals("PURCHASE_CHECKOUT")) {
            steps.add(step("step_005_stop_before_payment", "COMMIT", "실제 결제/구매 commit 전에 중단한다.", Map.of("type", "stop_when", "options", Map.of("condition", "before_payment_commit")), "none", false));
        }
        if (scenarioType.equals("SIGNUP_LEAD_FORM") || scenarioType.equals("CONTACT")) {
            steps.add(step("step_005_stop_before_submit", "COMMIT", "실제 form 제출 전에 중단한다.", Map.of("type", "stop_when", "options", Map.of("condition", "before_real_submit")), "none", false));
        }
        return steps;
    }

    private Map<String, Object> step(String id, String stage, String description, Map<String, Object> action, String settleType, boolean checkpoint) {
        return Map.of(
                "step_id", id,
                "stage", stage,
                "description", description,
                "action", action,
                "settle_strategy", Map.of("type", settleType, "timeout_ms", settleType.equals("none") ? 0 : 3000),
                "checkpoint", checkpoint
        );
    }

    private String stageFor(String scenarioType) {
        return switch (scenarioType) {
            case "PRICING" -> "VALUE";
            case "PURCHASE_CHECKOUT" -> "COMMIT";
            case "SIGNUP_LEAD_FORM" -> "INPUT";
            default -> "CTA";
        };
    }

    private List<String> requiredEntrypoints(String scenarioType) {
        return switch (scenarioType) {
            case "SIGNUP_LEAD_FORM" -> List.of("signup", "form");
            case "PRICING" -> List.of("pricing");
            case "PURCHASE_CHECKOUT" -> List.of("pricing", "cart", "checkout");
            case "CONTACT" -> List.of("contact", "form");
            default -> List.of("cta");
        };
    }

    private String readString(Map<String, Object> source, String camelKey, String snakeKey, String fallback) {
        Object value = source.get(camelKey);
        if (!(value instanceof String)) {
            value = source.get(snakeKey);
        }
        return value instanceof String text && !text.isBlank() ? text : fallback;
    }

    private String readSiteDiscoveryString(Map<String, Object> input, String key) {
        Object siteDiscovery = input.get("site_discovery_result");
        if (siteDiscovery instanceof Map<?, ?> rawMap) {
            Object value = rawMap.get(key);
            if (value instanceof String text && !text.isBlank()) {
                return text;
            }
        }
        return "";
    }

    private List<String> readStringList(Object primary, Object secondary) {
        Object value = primary == null ? secondary : primary;
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }
}
