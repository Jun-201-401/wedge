package com.wedge.run.application;

import com.wedge.run.api.dto.RunResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RunExecuteRequestMessageFactory {
    private static final String RUNNER_MESSAGE_TYPE = "run.execute.request";
    private static final String SCHEMA_VERSION = "0.5";
    private static final String PRODUCER = "spring-api";

    public RunExecuteRequestMessage create(RunResponse run) {
        String messageId = UUID.randomUUID().toString();
        String runId = run.id().toString();
        String projectId = run.projectId().toString();
        String scenarioTemplateVersionId = run.scenarioTemplateVersionId().toString();
        String createdAt = OffsetDateTime.now().toString();

        Map<String, Object> payload = Map.of(
                "runId", runId,
                "projectId", projectId,
                "triggerSource", run.triggerSource(),
                "startUrl", run.startUrl().toString(),
                "goal", resolveGoal(run),
                "devicePreset", run.devicePreset(),
                "scenarioTemplateVersionId", scenarioTemplateVersionId,
                "scenarioPlan", createScenarioPlan(run, scenarioTemplateVersionId),
                "artifactPolicy", Map.of(
                        "captureScreenshot", true,
                        "captureDomSnapshot", true
                )
        );

        return new RunExecuteRequestMessage(
                messageId,
                RUNNER_MESSAGE_TYPE,
                SCHEMA_VERSION,
                createdAt,
                PRODUCER,
                runId,
                "run:" + runId,
                payload
        );
    }

    private Map<String, Object> createScenarioPlan(RunResponse run, String scenarioTemplateVersionId) {
        return Map.of(
                "schema_version", SCHEMA_VERSION,
                "plan_id", "plan_" + run.id(),
                "scenario_type", "custom_compiled",
                "goal", resolveGoal(run),
                "start_url", run.startUrl().toString(),
                "environment", Map.of(
                        "device", run.devicePreset(),
                        "viewport", createViewport(run.devicePreset()),
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
                                "action", Map.of(
                                        "type", "goto",
                                        "target", run.startUrl().toString()
                                ),
                                "settle_strategy", Map.of(
                                        "type", "network_idle",
                                        "timeout_ms", 10000
                                ),
                                "checkpoint", true
                        )
                ),
                "template_key", "template-" + scenarioTemplateVersionId
        );
    }

    private Map<String, Object> createViewport(String devicePreset) {
        return switch (devicePreset) {
            case "mobile" -> Map.of("width", 390, "height", 844);
            case "tablet" -> Map.of("width", 820, "height", 1180);
            default -> Map.of("width", 1440, "height", 900);
        };
    }

    private String resolveGoal(RunResponse run) {
        return (run.goal() == null || run.goal().isBlank()) ? "기본 실행 흐름 점검" : run.goal();
    }
}
