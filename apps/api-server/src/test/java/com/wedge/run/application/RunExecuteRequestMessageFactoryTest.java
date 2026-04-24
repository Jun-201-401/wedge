package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
        Map<String, Object> scenarioPlan = Map.of(
                "schema_version", "0.5",
                "plan_id", "plan_" + runId,
                "scenario_type", "custom_compiled",
                "goal", "무료 체험 CTA까지의 흐름 점검",
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
    }

    @Test
    void createRejectsMissingMaterializedScenarioPlan() {
        assertThatThrownBy(() -> factory.create(new RunExecutionRequestSource(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "WEB",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                Map.of()
        )))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("materialized scenarioPlan");
    }
}
