package com.wedge.run.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.run.application.RunExecuteRequestMessage;
import com.wedge.run.application.RunRequestPublisher;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitRunRequestPublisher implements RunRequestPublisher {
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final String exchangeName;
    private final String queueName;

    public RabbitRunRequestPublisher(
            RabbitTemplate rabbitTemplate,
            ObjectMapper objectMapper,
            @Value("${wedge.runner.mq.exchange:wedge.direct}") String exchangeName,
            @Value("${wedge.runner.mq.run-execute-queue:run.execute.request}") String queueName
    ) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
        this.exchangeName = exchangeName;
        this.queueName = queueName;
    }

    @Override
    public void publish(RunExecuteRequestMessage message) {
        try {
            rabbitTemplate.convertAndSend(exchangeName, queueName, objectMapper.writeValueAsString(message));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize run.execute.request message", exception);
        }
    }
}
