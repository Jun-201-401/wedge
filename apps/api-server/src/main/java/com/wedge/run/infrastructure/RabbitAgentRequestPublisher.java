package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.run.application.AgentExecuteRequestMessage;
import com.wedge.run.application.AgentRequestPublisher;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitAgentRequestPublisher implements AgentRequestPublisher {
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final String exchangeName;
    private final String queueName;

    public RabbitAgentRequestPublisher(
            RabbitTemplate rabbitTemplate,
            ObjectMapper objectMapper,
            @Value("${wedge.runner.mq.exchange:wedge.direct}") String exchangeName,
            @Value("${wedge.runner.mq.agent-execute-queue:agent.execute.request}") String queueName
    ) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
        this.exchangeName = exchangeName;
        this.queueName = queueName;
    }

    @Override
    public void publish(AgentExecuteRequestMessage message) {
        try {
            rabbitTemplate.convertAndSend(exchangeName, queueName, objectMapper.writeValueAsString(message));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize agent.execute.request message", exception);
        }
    }
}
