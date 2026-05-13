package com.wedge.run.application;

import java.net.URI;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RunExecuteRequestMessageFactory {
    static final String RUN_EXECUTE_MESSAGE_TYPE = "run.execute.request";
    static final String AGENT_EXECUTE_MESSAGE_TYPE = "agent.execute.request";
    private static final String RUN_SCHEMA_VERSION = "0.5";
    private static final String AGENT_SCHEMA_VERSION = "0.1";
    private static final String PRODUCER = "spring-api";

    public RunExecuteRequestMessage create(RunExecutionRequestSource run) {
        Map<String, Object> scenarioPlan = run.scenarioPlan();
        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            return createAgentExecuteRequest(run);
        }
        return createRunExecuteRequest(run, scenarioPlan);
    }

    private RunExecuteRequestMessage createRunExecuteRequest(RunExecutionRequestSource run, Map<String, Object> scenarioPlan) {
        String messageId = UUID.randomUUID().toString();
        String runId = run.id().toString();
        String projectId = run.projectId().toString();
        String createdAt = OffsetDateTime.now().toString();

        if (run.scenarioTemplateVersionId() == null) {
            throw new IllegalStateException("Cannot publish run.execute.request without a scenarioTemplateVersionId");
        }
        String payloadGoal = ScenarioPlanGoalResolver.resolve(scenarioPlan)
                .orElseGet(() -> resolveGoal(run));

        Map<String, Object> payload = Map.of(
                "runId", runId,
                "projectId", projectId,
                "triggerSource", run.triggerSource(),
                "startUrl", run.startUrl().toString(),
                "goal", payloadGoal,
                "devicePreset", run.devicePreset(),
                "scenarioTemplateVersionId", run.scenarioTemplateVersionId().toString(),
                "scenarioPlan", scenarioPlan,
                "artifactPolicy", Map.of(
                        "captureScreenshot", true,
                        "captureDomSnapshot", true
                )
        );

        return new RunExecuteRequestMessage(
                messageId,
                RUN_EXECUTE_MESSAGE_TYPE,
                RUN_SCHEMA_VERSION,
                createdAt,
                PRODUCER,
                runId,
                "run:" + runId,
                payload
        );
    }

    private RunExecuteRequestMessage createAgentExecuteRequest(RunExecutionRequestSource run) {
        String messageId = UUID.randomUUID().toString();
        String runId = run.id().toString();
        String idempotencyKey = "agent:" + runId;
        String createdAt = OffsetDateTime.now().toString();

        Map<String, Object> agentTask = new LinkedHashMap<>();
        agentTask.put("schema_version", AGENT_SCHEMA_VERSION);
        agentTask.put("task_id", runId);
        agentTask.put("attempt_id", UUID.randomUUID().toString());
        agentTask.put("attempt_index", 1);
        agentTask.put("idempotency_key", idempotencyKey);
        agentTask.put("run_id", runId);
        agentTask.put("project_id", run.projectId().toString());
        agentTask.put("goal_type", "CHECKOUT_ENTRY_VERIFICATION");
        agentTask.put("goal", resolveGoal(run));
        agentTask.put("start_url", run.startUrl().toString());
        agentTask.put("environment", createAgentEnvironment(run.devicePreset()));
        agentTask.put("budget", Map.of(
                "max_steps", 8,
                "max_duration_ms", 120000,
                "max_recovery_attempts", 2,
                "max_same_page_attempts", 3,
                "max_external_redirects", 1
        ));
        agentTask.put("observation_budget", Map.of(
                "max_candidates", 80,
                "max_visible_text_chars", 6000,
                "max_nearby_text_chars_per_candidate", 300,
                "max_dom_snapshot_bytes", 1000000,
                "max_ax_tree_bytes", 1000000,
                "max_artifacts_per_run", 80,
                "max_artifact_bytes_per_run", 5000000
        ));
        agentTask.put("allowed_navigation", Map.of(
                "allow_external_navigation", false,
                "allowed_origins", List.of(resolveOrigin(run.startUrl())),
                "allowed_checkout_redirect_origins", List.of()
        ));
        agentTask.put("product_selection_policy", Map.of(
                "mode", "PROVIDED_OR_OBVIOUS_ONLY",
                "provided_product_url", run.startUrl().toString(),
                "required_option_strategy", "FIRST_AVAILABLE",
                "allow_quantity_change", false,
                "max_add_to_cart_attempts", 1
        ));
        agentTask.put("risk_policy", Map.of(
                "allow_checkout_navigation", true,
                "allow_cart_mutation", true,
                "allow_shipping_form_entry", true,
                "allow_payment_info_entry", false,
                "allow_final_payment_submit", false,
                "allow_final_order_commit", false,
                "allow_destructive_action", false,
                "allow_external_message_send", false
        ));
        agentTask.put("test_data", createAgentTestData());
        agentTask.put("artifact_policy", Map.of(
                "capture_screenshots", true,
                "capture_dom_snapshots", true,
                "capture_ax_tree", true,
                "capture_trace", true
        ));

        return new RunExecuteRequestMessage(
                messageId,
                AGENT_EXECUTE_MESSAGE_TYPE,
                AGENT_SCHEMA_VERSION,
                createdAt,
                PRODUCER,
                runId,
                idempotencyKey,
                Map.of("agentTask", agentTask)
        );
    }

    private Map<String, Object> createAgentTestData() {
        Map<String, Object> testData = new LinkedHashMap<>();
        testData.put("email", "test@example.com");
        testData.put("name", "Test User");
        testData.put("phone", "01000000000");
        testData.put("shipping_address", null);
        testData.put("postal_code", null);
        testData.put("country", "KR");
        testData.put("coupon_code", null);
        testData.put("sandbox_payment", null);
        return testData;
    }

    private Map<String, Object> createAgentEnvironment(String devicePreset) {
        return Map.of(
                "device", devicePreset,
                "viewport", viewportFor(devicePreset),
                "locale", "ko-KR",
                "timezone", "Asia/Seoul",
                "auth_state", "anonymous"
        );
    }

    private Map<String, Integer> viewportFor(String devicePreset) {
        return switch (devicePreset) {
            case "mobile" -> Map.of("width", 390, "height", 844);
            case "tablet" -> Map.of("width", 768, "height", 1024);
            default -> Map.of("width", 1440, "height", 900);
        };
    }

    private String resolveOrigin(URI uri) {
        StringBuilder origin = new StringBuilder();
        origin.append(uri.getScheme()).append("://").append(uri.getHost());
        if (uri.getPort() != -1) {
            origin.append(":").append(uri.getPort());
        }
        return origin.toString();
    }

    private String resolveGoal(RunExecutionRequestSource run) {
        return (run.goal() == null || run.goal().isBlank()) ? "기본 실행 흐름 점검" : run.goal();
    }

}
