package com.wedge.scenarioauthoring.application;

import com.wedge.scenarioauthoring.domain.ScenarioAuthoringJob;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ScenarioAuthoringExecuteRequestMessageFactory {
    private static final String MESSAGE_TYPE = "scenario-authoring.execute.request";
    private static final String SCHEMA_VERSION = "0.5";
    private static final String PRODUCER = "api-server";

    public ScenarioAuthoringExecuteRequestMessage create(ScenarioAuthoringJob job, String requestedGoal, Map<String, Object> input, Map<String, Object> providerPolicy) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("authoringJobId", job.getId().toString());
        payload.put("projectId", job.getProjectId().toString());
        payload.put("sourceDiscoveryId", job.getSourceDiscoveryId().toString());
        payload.put("requestedGoal", requestedGoal);
        payload.put("input", input);
        payload.put("providerPolicy", providerPolicy);

        return new ScenarioAuthoringExecuteRequestMessage(
                UUID.randomUUID().toString(),
                MESSAGE_TYPE,
                SCHEMA_VERSION,
                OffsetDateTime.now().toString(),
                PRODUCER,
                job.getCorrelationId(),
                "scenario-authoring:" + job.getId(),
                payload
        );
    }
}
