package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RunExecuteRequestMessageFactoryTest {
    private final RunExecuteRequestMessageFactory factory = new RunExecuteRequestMessageFactory();

    @Test
    void createUsesMaterializedScenarioPlanFromSource() {
        UUID runId = UUID.randomUUID();
        UUID scenarioTemplateVersionId = UUID.randomUUID();
        Map<String, Object> scenarioPlan = sampleScenarioPlan(runId, "무료 체험 CTA까지의 흐름 점검");

        RunExecuteRequestMessage message = factory.create(new RunExecutionRequestSource(
                runId,
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                scenarioTemplateVersionId,
                scenarioPlan
        ));

        assertThat(message.messageType()).isEqualTo("run.execute.request");
        assertThat(message.correlationId()).isEqualTo(runId.toString());
        assertThat(message.idempotencyKey()).isEqualTo("run:" + runId);
        assertThat(message.payload()).containsEntry("scenarioTemplateVersionId", scenarioTemplateVersionId.toString());
        assertThat(message.payload()).containsEntry("scenarioPlan", scenarioPlan);
        assertThat(message.payload()).containsEntry("goal", "무료 체험 CTA까지의 흐름 점검");
    }

    @Test
    void createAlignsRunExecutePayloadGoalWithScenarioPlanGoal() {
        UUID runId = UUID.randomUUID();
        String scenarioGoal = "랜딩 전환 CTA 점검 · 첫 화면만 보기";
        Map<String, Object> scenarioPlan = Map.of(
                "schema_version", "0.5",
                "plan_id", "plan_" + runId,
                "scenario_type", "custom_compiled",
                "goal", scenarioGoal,
                "start_url", "https://www.mgdj.co.kr/",
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
                "steps", List.of(
                        Map.of(
                                "step_id", "step_001_goto",
                                "stage", "FIRST_VIEW",
                                "description", "Discovery 추천 URL에 진입한다.",
                                "action", Map.of("type", "goto", "target", "https://www.mgdj.co.kr/"),
                                "settle_strategy", Map.of("type", "network_idle", "timeout_ms", 3000),
                                "checkpoint", true
                        )
                )
        );

        RunExecuteRequestMessage message = factory.create(new RunExecutionRequestSource(
                runId,
                UUID.randomUUID(),
                "WEB",
                URI.create("https://www.mgdj.co.kr/"),
                "랜딩 전환 CTA 점검",
                "desktop",
                UUID.randomUUID(),
                scenarioPlan
        ));

        assertThat(message.messageType()).isEqualTo("run.execute.request");
        assertThat(message.payload()).containsEntry("goal", scenarioGoal);
        assertThat(message.payload()).containsEntry("scenarioPlan", scenarioPlan);
    }

    @Test
    void createUsesScenarioPlanGoalAsRunExecutePayloadGoal() {
        UUID runId = UUID.randomUUID();
        UUID scenarioTemplateVersionId = UUID.randomUUID();
        String displayGoal = "문의 / 상담 신청 흐름 점검";
        String executionGoal = "문의 / 상담 신청 흐름 점검 · 첫 화면만 보기";
        Map<String, Object> scenarioPlan = sampleScenarioPlan(runId, executionGoal);

        RunExecuteRequestMessage message = factory.create(new RunExecutionRequestSource(
                runId,
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com"),
                displayGoal,
                "desktop",
                scenarioTemplateVersionId,
                scenarioPlan
        ));

        assertThat(message.messageType()).isEqualTo("run.execute.request");
        assertThat(message.payload()).containsEntry("goal", executionGoal);
        assertThat(message.payload()).containsEntry("scenarioPlan", scenarioPlan);
    }

    @Test
    void createUsesAgentExecuteRequestWhenScenarioPlanIsMissing() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();

        RunExecuteRequestMessage message = factory.create(new RunExecutionRequestSource(
                runId,
                projectId,
                "WEB",
                URI.create("https://example.com/product/sample"),
                "결제 없이 checkout 진입 경로 확인",
                "desktop",
                null,
                Map.of()
        ));

        assertThat(message.messageType()).isEqualTo("agent.execute.request");
        assertThat(message.schemaVersion()).isEqualTo("0.1");
        assertThat(message.correlationId()).isEqualTo(runId.toString());
        assertThat(message.idempotencyKey()).isEqualTo("agent:" + runId);
        assertThat(message.payload()).containsKey("agentTask");

        @SuppressWarnings("unchecked")
        Map<String, Object> agentTask = (Map<String, Object>) message.payload().get("agentTask");
        assertThat(agentTask)
                .containsEntry("run_id", runId.toString())
                .containsEntry("project_id", projectId.toString())
                .containsEntry("goal_type", "CHECKOUT_ENTRY_VERIFICATION")
                .containsEntry("start_url", "https://example.com/product/sample");
        assertThat(agentTask).containsKey("allowed_navigation");
        assertThat(agentTask).doesNotContainKey("scenarioPlan");
    }

    private Map<String, Object> sampleScenarioPlan(UUID runId, String goal) {
        return Map.of(
                "schema_version", "0.5",
                "plan_id", "plan_" + runId,
                "scenario_type", "custom_compiled",
                "goal", goal,
                "start_url", "https://example.com",
                "environment", Map.of(
                        "device", "desktop",
                        "viewport", Map.of("width", 1440, "height", 900),
                        "locale", "ko-KR",
                        "timezone", "Asia/Seoul",
                        "permissions", List.of(),
                        "auth_state", "anonymous"
                ),
                "safety", Map.of(
                        "allow_external_navigation", false,
                        "allow_payment_commit", false,
                        "allow_destructive_action", false,
                        "use_synthetic_inputs", true,
                        "stop_before_real_payment", true
                ),
                "steps", List.of(
                        Map.of(
                                "step_id", "step_001_goto",
                                "stage", "FIRST_VIEW",
                                "description", "랜딩 첫 화면 로드",
                                "action", Map.of("type", "goto", "target", Map.of("url", "https://example.com")),
                                "settle_strategy", Map.of("type", "network_idle", "timeout_ms", 10000),
                                "checkpoint", true
                        )
                )
        );
    }
}
