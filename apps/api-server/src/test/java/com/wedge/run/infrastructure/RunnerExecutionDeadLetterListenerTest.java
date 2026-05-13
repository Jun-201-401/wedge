package com.wedge.run.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.run.application.RunFailureCodes;
import com.wedge.run.application.RunService;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.annotation.RabbitListener;

@ExtendWith(MockitoExtension.class)
class RunnerExecutionDeadLetterListenerTest {
    @Mock
    private RunService runService;

    private RunnerExecutionDeadLetterListener listener;

    @BeforeEach
    void setUp() {
        listener = new RunnerExecutionDeadLetterListener(new ObjectMapper(), runService);
    }

    @Test
    void runExecuteDeadLetterMarksRunStartFailedFromPayloadRunId() throws Exception {
        UUID runId = UUID.randomUUID();
        String body = new ObjectMapper().writeValueAsString(Map.of(
                "messageType", "run.execute.request",
                "payload", Map.of("runId", runId.toString())
        ));

        listener.handleRunExecuteDeadLetter(body);

        verify(runService).markStartFailedIfAwaitingRunner(
                eq(runId),
                eq(RunFailureCodes.RUN_START_FAILED),
                eq("요청을 시작하지 못했습니다.")
        );
    }

    @Test
    void agentExecuteDeadLetterMarksRunStartFailedFromAgentTaskRunId() throws Exception {
        UUID runId = UUID.randomUUID();
        String body = new ObjectMapper().writeValueAsString(Map.of(
                "messageType", "agent.execute.request",
                "payload", Map.of("agentTask", Map.of("run_id", runId.toString()))
        ));

        listener.handleAgentExecuteDeadLetter(body);

        verify(runService).markStartFailedIfAwaitingRunner(
                eq(runId),
                eq(RunFailureCodes.RUN_START_FAILED),
                eq("요청을 시작하지 못했습니다.")
        );
    }

    @Test
    void invalidDeadLetterPayloadIsAckedWithoutFailingAnyRun() {
        listener.handleRunExecuteDeadLetter("{\"payload\":{\"runId\":\"not-a-uuid\"}}");

        verify(runService, never()).markStartFailedIfAwaitingRunner(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void invalidPayloadRunIdDoesNotFallBackToCorrelationId() throws Exception {
        String body = new ObjectMapper().writeValueAsString(Map.of(
                "correlationId", UUID.randomUUID().toString(),
                "payload", Map.of("runId", "not-a-uuid")
        ));

        listener.handleRunExecuteDeadLetter(body);

        verify(runService, never()).markStartFailedIfAwaitingRunner(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void conflictingExplicitRunIdsAreAckedWithoutFailingAnyRun() throws Exception {
        String body = new ObjectMapper().writeValueAsString(Map.of(
                "payload", Map.of(
                        "runId", UUID.randomUUID().toString(),
                        "run_id", UUID.randomUUID().toString()
                )
        ));

        listener.handleRunExecuteDeadLetter(body);

        verify(runService, never()).markStartFailedIfAwaitingRunner(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void listenerMethodsAreBoundToRunnerDeadLetterQueues() throws NoSuchMethodException {
        Method runListener = RunnerExecutionDeadLetterListener.class.getDeclaredMethod("handleRunExecuteDeadLetter", String.class);
        Method agentListener = RunnerExecutionDeadLetterListener.class.getDeclaredMethod("handleAgentExecuteDeadLetter", String.class);

        assertThat(runListener.getAnnotation(RabbitListener.class).queues())
                .containsExactly("${wedge.runner.mq.run-execute-dead-letter-queue:run.execute.dlq}");
        assertThat(agentListener.getAnnotation(RabbitListener.class).queues())
                .containsExactly("${wedge.runner.mq.agent-execute-dead-letter-queue:agent.execute.dlq}");
    }
}
