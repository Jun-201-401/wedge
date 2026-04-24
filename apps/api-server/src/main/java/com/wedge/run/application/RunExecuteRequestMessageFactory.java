package com.wedge.run.application;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RunExecuteRequestMessageFactory {
    private static final String RUNNER_MESSAGE_TYPE = "run.execute.request";
    private static final String SCHEMA_VERSION = "0.5";
    private static final String PRODUCER = "spring-api";

    public RunExecuteRequestMessage create(RunExecutionRequestSource run) {
        String messageId = UUID.randomUUID().toString();
        String runId = run.id().toString();
        String projectId = run.projectId().toString();
        String scenarioTemplateVersionId = run.scenarioTemplateVersionId().toString();
        String createdAt = OffsetDateTime.now().toString();
        Map<String, Object> scenarioPlan = run.scenarioPlan();

        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            throw new IllegalStateException("Cannot publish run.execute.request without a materialized scenarioPlan");
        }

        Map<String, Object> payload = Map.of(
                "runId", runId,
                "projectId", projectId,
                "triggerSource", run.triggerSource(),
                "startUrl", run.startUrl().toString(),
                "goal", resolveGoal(run),
                "devicePreset", run.devicePreset(),
                "scenarioTemplateVersionId", scenarioTemplateVersionId,
                "scenarioPlan", scenarioPlan,
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

    private String resolveGoal(RunExecutionRequestSource run) {
        return (run.goal() == null || run.goal().isBlank()) ? "기본 실행 흐름 점검" : run.goal();
    }
}
