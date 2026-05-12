package com.wedge.run.application;

import java.net.URI;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class AgentExecuteRequestMessageFactory {
    private static final String AGENT_MESSAGE_TYPE = "agent.execute.request";
    private static final String SCHEMA_VERSION = "0.1";
    private static final String PRODUCER = "spring-api";

    private final AgentReplayHintsFactory replayHintsFactory;

    public AgentExecuteRequestMessageFactory(AgentReplayHintsFactory replayHintsFactory) {
        this.replayHintsFactory = replayHintsFactory;
    }

    public AgentExecuteRequestMessage create(
            RunExecutionRequestSource run,
            Optional<Map<String, Object>> latestSuccessfulTrace,
            int attemptIndex
    ) {
        String messageId = UUID.randomUUID().toString();
        String runId = run.id().toString();
        String idempotencyKey = "agent:run:" + runId + ":attempt:" + attemptIndex;
        Map<String, Object> agentTask = createAgentTask(run, attemptIndex, idempotencyKey);
        latestSuccessfulTrace
                .flatMap(replayHintsFactory::create)
                .ifPresent(replayHints -> agentTask.put("replay_hints", replayHints));

        return new AgentExecuteRequestMessage(
                messageId,
                AGENT_MESSAGE_TYPE,
                SCHEMA_VERSION,
                OffsetDateTime.now().toString(),
                PRODUCER,
                runId,
                idempotencyKey,
                Map.of("agentTask", agentTask)
        );
    }

    private Map<String, Object> createAgentTask(RunExecutionRequestSource run, int attemptIndex, String idempotencyKey) {
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("schema_version", "0.1");
        task.put("task_id", UUID.randomUUID().toString());
        task.put("attempt_id", UUID.randomUUID().toString());
        task.put("attempt_index", attemptIndex);
        task.put("idempotency_key", idempotencyKey);
        task.put("run_id", run.id().toString());
        task.put("project_id", run.projectId().toString());
        task.put("goal_type", "CHECKOUT_ENTRY_VERIFICATION");
        if (run.goal() != null && !run.goal().isBlank()) {
            task.put("goal", run.goal());
        }
        task.put("start_url", run.startUrl().toString());
        task.put("environment", resolveEnvironment(run));
        task.put("budget", Map.of(
                "max_steps", 8,
                "max_duration_ms", 120_000,
                "max_recovery_attempts", 2,
                "max_same_page_attempts", 3,
                "max_external_redirects", 1
        ));
        task.put("observation_budget", Map.of(
                "max_candidates", 80,
                "max_visible_text_chars", 6_000,
                "max_nearby_text_chars_per_candidate", 300,
                "max_dom_snapshot_bytes", 1_000_000,
                "max_ax_tree_bytes", 1_000_000,
                "max_artifacts_per_run", 80,
                "max_artifact_bytes_per_run", 5_000_000
        ));
        task.put("allowed_navigation", Map.of(
                "allow_external_navigation", false,
                "allowed_origins", List.of(origin(run.startUrl())),
                "allowed_checkout_redirect_origins", List.of()
        ));
        task.put("product_selection_policy", Map.of(
                "mode", "PROVIDED_OR_OBVIOUS_ONLY",
                "provided_product_url", run.startUrl().toString(),
                "required_option_strategy", "FIRST_AVAILABLE",
                "allow_quantity_change", false,
                "max_add_to_cart_attempts", 1
        ));
        task.put("risk_policy", Map.of(
                "allow_checkout_navigation", true,
                "allow_cart_mutation", true,
                "allow_shipping_form_entry", true,
                "allow_payment_info_entry", false,
                "allow_final_payment_submit", false,
                "allow_final_order_commit", false,
                "allow_destructive_action", false,
                "allow_external_message_send", false
        ));
        task.put("artifact_policy", Map.of(
                "capture_screenshots", true,
                "capture_dom_snapshots", true,
                "capture_ax_tree", true,
                "capture_trace", true
        ));
        return task;
    }

    private Map<String, Object> resolveEnvironment(RunExecutionRequestSource run) {
        Object environment = run.scenarioPlan().get("environment");
        if (environment instanceof Map<?, ?> rawEnvironment) {
            @SuppressWarnings("unchecked")
            Map<String, Object> value = (Map<String, Object>) rawEnvironment;
            return value;
        }
        return Map.of(
                "device", run.devicePreset(),
                "viewport", Map.of("width", 1440, "height", 900),
                "locale", "ko-KR",
                "timezone", "Asia/Seoul",
                "auth_state", "anonymous"
        );
    }

    private String origin(URI uri) {
        int port = uri.getPort();
        String portSuffix = port == -1 ? "" : ":" + port;
        return uri.getScheme() + "://" + uri.getHost() + portSuffix;
    }
}
