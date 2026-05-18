package com.wedge.scenarioauthoring.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringJob;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import com.wedge.scenarioauthoring.infrastructure.ScenarioAuthoringJobMapper;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ScenarioAuthoringCallbackServiceTest {
    @Mock
    private ScenarioAuthoringJobMapper scenarioAuthoringJobMapper;

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private ScenarioAuthoringCallbackService service;

    @BeforeEach
    void setUp() {
        service = new ScenarioAuthoringCallbackService(
                scenarioAuthoringJobMapper,
                processedMessagePersistenceAdapter,
                objectMapper
        );
    }

    @Test
    void markStartFailedIfAwaitingRunnerFailsQueuedJob() throws Exception {
        UUID authoringJobId = UUID.randomUUID();
        ScenarioAuthoringJob queued = job(authoringJobId, ScenarioAuthoringStatus.QUEUED);
        ScenarioAuthoringJob failed = job(authoringJobId, ScenarioAuthoringStatus.FAILED);
        when(scenarioAuthoringJobMapper.findById(authoringJobId))
                .thenReturn(Optional.of(queued), Optional.of(failed));
        when(scenarioAuthoringJobMapper.failFromRunner(
                eq(authoringJobId),
                eq("[]"),
                anyString(),
                anyString(),
                anyString()
        )).thenReturn(1);
        ArgumentCaptor<String> validationCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> provenanceCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> failureCaptor = ArgumentCaptor.forClass(String.class);

        Optional<ScenarioAuthoringJob> result = service.markStartFailedIfAwaitingRunner(
                authoringJobId,
                "SCENARIO_AUTHORING_REQUEST_DEAD_LETTERED",
                "Scenario authoring request could not be delivered to Runner."
        );

        assertThat(result).contains(failed);
        verify(scenarioAuthoringJobMapper).failFromRunner(
                eq(authoringJobId),
                eq("[]"),
                validationCaptor.capture(),
                provenanceCaptor.capture(),
                failureCaptor.capture()
        );
        Map<String, Object> validation = readMap(validationCaptor.getValue());
        Map<String, Object> provenance = readMap(provenanceCaptor.getValue());
        Map<String, Object> failure = readMap(failureCaptor.getValue());
        assertThat(validation.get("schema_valid")).isEqualTo(false);
        assertThat(provenance).containsEntry("source", "dlq");
        assertThat(failure)
                .containsEntry("failure_code", "SCENARIO_AUTHORING_REQUEST_DEAD_LETTERED")
                .containsEntry("failure_message", "Scenario authoring request could not be delivered to Runner.");
    }

    @Test
    void markStartFailedIfAwaitingRunnerDoesNotOverrideRunningJob() {
        UUID authoringJobId = UUID.randomUUID();
        when(scenarioAuthoringJobMapper.findById(authoringJobId))
                .thenReturn(Optional.of(job(authoringJobId, ScenarioAuthoringStatus.RUNNING)));

        Optional<ScenarioAuthoringJob> result = service.markStartFailedIfAwaitingRunner(
                authoringJobId,
                "SCENARIO_AUTHORING_REQUEST_DEAD_LETTERED",
                "Scenario authoring request could not be delivered to Runner."
        );

        assertThat(result).isEmpty();
        verify(scenarioAuthoringJobMapper, never()).failFromRunner(any(), anyString(), anyString(), anyString(), anyString());
    }

    private Map<String, Object> readMap(String json) throws Exception {
        return objectMapper.readValue(json, new TypeReference<>() {
        });
    }

    private ScenarioAuthoringJob job(UUID authoringJobId, ScenarioAuthoringStatus status) {
        ScenarioAuthoringJob job = new ScenarioAuthoringJob();
        job.setId(authoringJobId);
        job.setStatus(status);
        return job;
    }
}
