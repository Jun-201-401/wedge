package com.wedge.analysis.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.application.AnalysisRequestMessage;
import com.wedge.analysis.application.AnalysisRequestPublisher;
import com.wedge.common.infrastructure.RabbitConfirmedMessagePublisher;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitAnalysisRequestPublisher implements AnalysisRequestPublisher {
    private final RabbitConfirmedMessagePublisher rabbitConfirmedMessagePublisher;
    private final ObjectMapper objectMapper;
    private final String exchangeName;
    private final String queueName;

    public RabbitAnalysisRequestPublisher(
            RabbitConfirmedMessagePublisher rabbitConfirmedMessagePublisher,
            ObjectMapper objectMapper,
            @Value("${wedge.analyzer.mq.exchange:wedge.direct}") String exchangeName,
            @Value("${wedge.analyzer.mq.analysis-request-queue:analysis.request}") String queueName
    ) {
        this.rabbitConfirmedMessagePublisher = rabbitConfirmedMessagePublisher;
        this.objectMapper = objectMapper;
        this.exchangeName = exchangeName;
        this.queueName = queueName;
    }

    @Override
    public void publish(AnalysisRequestMessage message) {
        try {
            rabbitConfirmedMessagePublisher.convertAndSend(
                    exchangeName,
                    queueName,
                    objectMapper.writeValueAsString(message),
                    message.messageId()
            );
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize analysis.request message", exception);
        }
    }
}
