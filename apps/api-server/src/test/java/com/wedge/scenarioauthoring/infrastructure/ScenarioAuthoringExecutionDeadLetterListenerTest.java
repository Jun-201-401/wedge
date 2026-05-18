package com.wedge.scenarioauthoring.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringCallbackService;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.annotation.RabbitListener;

@ExtendWith(MockitoExtension.class)
class ScenarioAuthoringExecutionDeadLetterListenerTest {
    @Mock
    private ScenarioAuthoringCallbackService scenarioAuthoringCallbackService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private ScenarioAuthoringExecutionDeadLetterListener listener;

    @BeforeEach
    void setUp() {
        listener = new ScenarioAuthoringExecutionDeadLetterListener(objectMapper, scenarioAuthoringCallbackService);
    }

    @Test
    void scenarioAuthoringExecuteDeadLetterMarksJobFailedFromPayloadAuthoringJobId() throws Exception {
        UUID authoringJobId = UUID.randomUUID();
        String body = objectMapper.writeValueAsString(Map.of(
                "messageType", "scenario-authoring.execute.request",
                "payload", Map.of("authoringJobId", authoringJobId.toString())
        ));
        when(scenarioAuthoringCallbackService.markStartFailedIfAwaitingRunner(
                eq(authoringJobId),
                eq("SCENARIO_AUTHORING_REQUEST_DEAD_LETTERED"),
                eq("Scenario authoring request could not be delivered to Runner.")
        )).thenReturn(Optional.empty());

        listener.handleScenarioAuthoringExecuteDeadLetter(body);

        verify(scenarioAuthoringCallbackService).markStartFailedIfAwaitingRunner(
                eq(authoringJobId),
                eq("SCENARIO_AUTHORING_REQUEST_DEAD_LETTERED"),
                eq("Scenario authoring request could not be delivered to Runner.")
        );
    }

    @Test
    void invalidScenarioAuthoringDeadLetterPayloadIsAckedWithoutFailingJob() {
        listener.handleScenarioAuthoringExecuteDeadLetter("{\"payload\":{\"authoringJobId\":\"not-a-uuid\"}}");

        verify(scenarioAuthoringCallbackService, never()).markStartFailedIfAwaitingRunner(any(), any(), any());
    }

    @Test
    void conflictingAuthoringJobIdsAreAckedWithoutFailingJob() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "payload", Map.of(
                        "authoringJobId", UUID.randomUUID().toString(),
                        "authoring_job_id", UUID.randomUUID().toString()
                )
        ));

        listener.handleScenarioAuthoringExecuteDeadLetter(body);

        verify(scenarioAuthoringCallbackService, never()).markStartFailedIfAwaitingRunner(any(), any(), any());
    }

    @Test
    void listenerMethodIsBoundToScenarioAuthoringDeadLetterQueue() throws NoSuchMethodException {
        Method method = ScenarioAuthoringExecutionDeadLetterListener.class
                .getDeclaredMethod("handleScenarioAuthoringExecuteDeadLetter", String.class);

        assertThat(method.getAnnotation(RabbitListener.class).queues())
                .containsExactly("${wedge.runner.mq.scenario-authoring-execute-dead-letter-queue:scenario-authoring.execute.dlq}");
    }
}
