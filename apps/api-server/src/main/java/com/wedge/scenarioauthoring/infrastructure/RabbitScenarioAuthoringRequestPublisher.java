package com.wedge.scenarioauthoring.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringExecuteRequestMessage;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringRequestPublisher;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitScenarioAuthoringRequestPublisher implements ScenarioAuthoringRequestPublisher {
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final String exchangeName;
    private final String queueName;

    public RabbitScenarioAuthoringRequestPublisher(
            RabbitTemplate rabbitTemplate,
            ObjectMapper objectMapper,
            @Value("${wedge.runner.mq.exchange:wedge.direct}") String exchangeName,
            @Value("${wedge.runner.mq.scenario-authoring-execute-queue:scenario-authoring.execute.request}") String queueName
    ) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
        this.exchangeName = exchangeName;
        this.queueName = queueName;
    }

    @Override
    public void publish(ScenarioAuthoringExecuteRequestMessage message) {
        try {
            rabbitTemplate.convertAndSend(exchangeName, queueName, objectMapper.writeValueAsString(message));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize scenario-authoring.execute.request message", exception);
        }
    }
}
