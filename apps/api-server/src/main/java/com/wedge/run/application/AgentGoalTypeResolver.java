package com.wedge.run.application;

import java.util.Locale;
import java.util.Map;

final class AgentGoalTypeResolver {
    private AgentGoalTypeResolver() {
    }

    static String resolve(RunExecutionRequestSource run) {
        String scenarioType = readScenarioType(run.scenarioPlan());
        if (scenarioType != null) {
            return fromScenarioType(scenarioType);
        }
        return fromGoalText(run.goal());
    }

    private static String readScenarioType(Map<String, Object> scenarioPlan) {
        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            return null;
        }
        Object fitRequirements = scenarioPlan.get("fit_requirements");
        if (fitRequirements instanceof Map<?, ?> fitRequirementsMap) {
            Object requiredFlowType = fitRequirementsMap.get("required_flow_type");
            if (requiredFlowType instanceof String text && !text.isBlank()) {
                return text;
            }
        }
        Object scenarioType = scenarioPlan.get("scenario_type");
        return scenarioType instanceof String text && !text.isBlank() ? text : null;
    }

    private static String fromScenarioType(String scenarioType) {
        return switch (scenarioType) {
            case "LANDING_CTA" -> "LANDING_CTA_VERIFICATION";
            case "SIGNUP_LEAD_FORM" -> "SIGNUP_LEAD_FORM_VERIFICATION";
            case "PRICING" -> "PRICING_FLOW_VERIFICATION";
            case "CONTACT" -> "CONTACT_FLOW_VERIFICATION";
            case "CONTENT_ONLY" -> "CONTENT_ONLY_REVIEW";
            case "PURCHASE_CHECKOUT" -> "CHECKOUT_ENTRY_VERIFICATION";
            default -> "CHECKOUT_ENTRY_VERIFICATION";
        };
    }

    private static String fromGoalText(String goal) {
        String normalized = goal == null ? "" : goal.toLowerCase(Locale.ROOT);
        if (containsAny(normalized, "가입", "리드", "회원가입", "signup", "sign up", "lead", "register")) {
            return "SIGNUP_LEAD_FORM_VERIFICATION";
        }
        if (containsAny(normalized, "문의", "상담", "데모", "contact", "inquiry", "consult", "demo")) {
            return "CONTACT_FLOW_VERIFICATION";
        }
        if (containsAny(normalized, "가격", "요금", "요금제", "플랜", "pricing", "price", "plan")) {
            return "PRICING_FLOW_VERIFICATION";
        }
        if (containsAny(normalized, "랜딩", "cta", "전환", "landing")) {
            return "LANDING_CTA_VERIFICATION";
        }
        if (containsAny(normalized, "콘텐츠", "내용", "content")) {
            return "CONTENT_ONLY_REVIEW";
        }
        if (containsAny(normalized, "구매", "결제", "주문", "장바구니", "카트", "checkout", "payment", "cart", "order", "purchase", "buy")) {
            return "CHECKOUT_ENTRY_VERIFICATION";
        }
        return "CHECKOUT_ENTRY_VERIFICATION";
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) {
            if (value.contains(needle)) {
                return true;
            }
        }
        return false;
    }
}
