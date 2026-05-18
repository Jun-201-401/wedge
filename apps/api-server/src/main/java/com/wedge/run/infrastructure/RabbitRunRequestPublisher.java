package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.infrastructure.RabbitConfirmedMessagePublisher;
import com.wedge.run.application.RunExecuteRequestMessage;
import com.wedge.run.application.RunRequestPublisher;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitRunRequestPublisher implements RunRequestPublisher {
    private static final String RUN_EXECUTE_MESSAGE_TYPE = "run.execute.request";
    private static final String AGENT_EXECUTE_MESSAGE_TYPE = "agent.execute.request";

    private final RabbitConfirmedMessagePublisher rabbitConfirmedMessagePublisher;
    private final ObjectMapper objectMapper;
    private final String exchangeName;
    private final String runExecuteQueueName;
    private final String agentExecuteQueueName;

    public RabbitRunRequestPublisher(
            RabbitConfirmedMessagePublisher rabbitConfirmedMessagePublisher,
            ObjectMapper objectMapper,
            @Value("${wedge.runner.mq.exchange:wedge.direct}") String exchangeName,
            @Value("${wedge.runner.mq.run-execute-queue:run.execute.request}") String runExecuteQueueName,
            @Value("${wedge.runner.mq.agent-execute-queue:agent.execute.request}") String agentExecuteQueueName
    ) {
        this.rabbitConfirmedMessagePublisher = rabbitConfirmedMessagePublisher;
        this.objectMapper = objectMapper;
        this.exchangeName = exchangeName;
        this.runExecuteQueueName = runExecuteQueueName;
        this.agentExecuteQueueName = agentExecuteQueueName;
    }

    @Override
    public void publish(RunExecuteRequestMessage message) {
        try {
            rabbitConfirmedMessagePublisher.convertAndSend(
                    exchangeName,
                    routingKeyFor(message),
                    objectMapper.writeValueAsString(message),
                    message.messageId()
            );
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize runner request message", exception);
        }
    }

    private String routingKeyFor(RunExecuteRequestMessage message) {
        return switch (message.messageType()) {
            case RUN_EXECUTE_MESSAGE_TYPE -> runExecuteQueueName;
            case AGENT_EXECUTE_MESSAGE_TYPE -> agentExecuteQueueName;
            default -> throw new IllegalArgumentException("Unsupported runner request messageType: " + message.messageType());
        };
    }
}
