package com.wedge.discovery.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.discovery.application.DiscoveryExecuteRequestMessage;
import com.wedge.discovery.application.DiscoveryRequestPublisher;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitDiscoveryRequestPublisher implements DiscoveryRequestPublisher {
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final String exchangeName;
    private final String queueName;

    public RabbitDiscoveryRequestPublisher(
            RabbitTemplate rabbitTemplate,
            ObjectMapper objectMapper,
            @Value("${wedge.runner.mq.exchange:wedge.direct}") String exchangeName,
            @Value("${wedge.runner.mq.discovery-execute-queue:discovery.execute.request}") String queueName
    ) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
        this.exchangeName = exchangeName;
        this.queueName = queueName;
    }

    @Override
    public void publish(DiscoveryExecuteRequestMessage message) {
        try {
            rabbitTemplate.convertAndSend(exchangeName, queueName, objectMapper.writeValueAsString(message));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize discovery.execute.request message", exception);
        }
    }
}
