package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AgentExecuteRequestMessageFactoryTest {
    private final AgentExecuteRequestMessageFactory factory = new AgentExecuteRequestMessageFactory(new AgentReplayHintsFactory());

    @Test
    void createBuildsAgentTaskWithReplayHintsFromLatestSuccessfulTrace() {
        UUID runId = UUID.randomUUID();
        UUID sourceTraceId = UUID.randomUUID();
        UUID decisionId = UUID.randomUUID();
        RunExecutionRequestSource source = sampleSource(runId);
        Map<String, Object> trace = Map.of(
                "trace_id", sourceTraceId.toString(),
                "final_outcome", "SUCCESS_CHECKOUT_ENTRY_REACHED",
                "events", List.of(Map.of(
                        "event_type", "AGENT_ACTION_COMPLETED",
                        "payload", Map.of("decision_id", decisionId.toString())
                )),
                "decisions", List.of(Map.of(
                        "decision_id", decisionId.toString(),
                        "stage", "CTA",
                        "reason", "prior checkout CTA worked",
                        "confidence", 0.87,
                        "action", Map.of(
                                "tool", "click",
                                "target_key", "#checkout",
                                "target", Map.of("selector", "#checkout", "text", "Checkout")
                        )
                ))
        );

        AgentExecuteRequestMessage message = factory.create(source, Optional.of(trace), 2);

        assertThat(message.messageType()).isEqualTo("agent.execute.request");
        assertThat(message.schemaVersion()).isEqualTo("0.1");
        assertThat(message.correlationId()).isEqualTo(runId.toString());
        assertThat(message.idempotencyKey()).isEqualTo("agent:run:" + runId + ":attempt:2");

        @SuppressWarnings("unchecked")
        Map<String, Object> agentTask = (Map<String, Object>) message.payload().get("agentTask");
        assertThat(agentTask).containsEntry("run_id", runId.toString());
        assertThat(agentTask).containsEntry("attempt_index", 2);
        assertThat(agentTask).containsEntry("goal_type", "CHECKOUT_ENTRY_VERIFICATION");
        assertThat(agentTask).containsKey("replay_hints");

        @SuppressWarnings("unchecked")
        Map<String, Object> replayHints = (Map<String, Object>) agentTask.get("replay_hints");
        assertThat(replayHints).containsEntry("source_trace_id", sourceTraceId.toString());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> steps = (List<Map<String, Object>>) replayHints.get("steps");
        assertThat(steps).hasSize(1);
        assertThat(steps.get(0)).containsEntry("target_key", "#checkout");
        assertThat(steps.get(0)).containsEntry("confidence", 0.87);
    }

    @Test
    void createBuildsReplayHintsFromContractAgentTraceTurns() {
        UUID runId = UUID.randomUUID();
        UUID sourceTraceId = UUID.randomUUID();
        RunExecutionRequestSource source = sampleSource(runId);
        Map<String, Object> trace = Map.of(
                "trace_id", sourceTraceId.toString(),
                "schema_version", "0.1",
                "run_id", runId.toString(),
                "outcome", Map.of("status", "SUCCESS", "reason", "done"),
                "turns", List.of(Map.of(
                        "turn", 1,
                        "decision", Map.of(
                                "kind", "act",
                                "stage", "CTA",
                                "description", "Click checkout",
                                "reason", "prior checkout CTA worked",
                                "confidence", 0.87,
                                "targetKey", "#checkout",
                                "action", Map.of(
                                        "type", "click",
                                        "target", Map.of("selector", "#checkout", "text", "Checkout")
                                )
                        ),
                        "policy", Map.of("allowed", true),
                        "actionResult", Map.of("completed", true)
                ))
        );

        AgentExecuteRequestMessage message = factory.create(source, Optional.of(trace), 2);

        @SuppressWarnings("unchecked")
        Map<String, Object> agentTask = (Map<String, Object>) message.payload().get("agentTask");
        assertThat(agentTask).containsKey("replay_hints");

        @SuppressWarnings("unchecked")
        Map<String, Object> replayHints = (Map<String, Object>) agentTask.get("replay_hints");
        assertThat(replayHints).containsEntry("source_trace_id", sourceTraceId.toString());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> steps = (List<Map<String, Object>>) replayHints.get("steps");
        assertThat(steps).hasSize(1);
        assertThat(steps.get(0)).containsEntry("target_key", "#checkout");
        assertThat(steps.get(0)).containsEntry("confidence", 0.87);
    }

    @Test
    void createOmitsReplayHintsWhenTraceHasNoCompletedSafeAction() {
        RunExecutionRequestSource source = sampleSource(UUID.randomUUID());
        Map<String, Object> trace = Map.of(
                "trace_id", UUID.randomUUID().toString(),
                "events", List.of(),
                "decisions", List.of(Map.of(
                        "decision_id", UUID.randomUUID().toString(),
                        "action", Map.of("tool", "click", "target_key", "#checkout")
                ))
        );

        AgentExecuteRequestMessage message = factory.create(source, Optional.of(trace), 1);

        @SuppressWarnings("unchecked")
        Map<String, Object> agentTask = (Map<String, Object>) message.payload().get("agentTask");
        assertThat(agentTask).doesNotContainKey("replay_hints");
    }

    @Test
    void createMapsGoalTypeFromScenarioPlanFitRequirements() {
        UUID runId = UUID.randomUUID();
        RunExecutionRequestSource source = new RunExecutionRequestSource(
                runId,
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com/pricing"),
                "가격 / 요금제 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                Map.of(
                        "fit_requirements", Map.of("required_flow_type", "PRICING"),
                        "environment", Map.of(
                                "device", "desktop",
                                "viewport", Map.of("width", 1440, "height", 900),
                                "locale", "ko-KR",
                                "timezone", "Asia/Seoul",
                                "auth_state", "anonymous"
                        )
                )
        );

        AgentExecuteRequestMessage message = factory.create(source, Optional.empty(), 1);

        @SuppressWarnings("unchecked")
        Map<String, Object> agentTask = (Map<String, Object>) message.payload().get("agentTask");
        assertThat(agentTask).containsEntry("goal_type", "PRICING_FLOW_VERIFICATION");
    }

    @Test
    void createMapsGoalTypeFromFallbackGoalText() {
        RunExecutionRequestSource source = new RunExecutionRequestSource(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com/signup"),
                "가입 / 리드 양식 점검",
                "desktop",
                null,
                Map.of()
        );

        AgentExecuteRequestMessage message = factory.create(source, Optional.empty(), 1);

        @SuppressWarnings("unchecked")
        Map<String, Object> agentTask = (Map<String, Object>) message.payload().get("agentTask");
        assertThat(agentTask).containsEntry("goal_type", "SIGNUP_LEAD_FORM_VERIFICATION");
    }

    private RunExecutionRequestSource sampleSource(UUID runId) {
        return new RunExecutionRequestSource(
                runId,
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com/product/sample"),
                "Find checkout entry",
                "desktop",
                UUID.randomUUID(),
                Map.of(
                        "environment", Map.of(
                                "device", "desktop",
                                "viewport", Map.of("width", 1440, "height", 900),
                                "locale", "ko-KR",
                                "timezone", "Asia/Seoul",
                                "auth_state", "anonymous"
                        )
                )
        );
    }
}
