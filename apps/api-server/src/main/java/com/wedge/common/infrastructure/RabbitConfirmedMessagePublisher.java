package com.wedge.common.infrastructure;

import java.time.Duration;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RabbitConfirmedMessagePublisher {
    private final RabbitTemplate rabbitTemplate;
    private final Duration confirmTimeout;

    @Autowired
    public RabbitConfirmedMessagePublisher(
            RabbitTemplate rabbitTemplate,
            @Value("${wedge.rabbitmq.publisher-confirm-timeout-ms:5000}") long confirmTimeoutMs
    ) {
        this(rabbitTemplate, Duration.ofMillis(confirmTimeoutMs));
    }

    RabbitConfirmedMessagePublisher(RabbitTemplate rabbitTemplate, Duration confirmTimeout) {
        this.rabbitTemplate = rabbitTemplate;
        this.confirmTimeout = confirmTimeout;
    }

    public void convertAndSend(String exchangeName, String routingKey, String payload, String correlationId) {
        CorrelationData correlationData = new CorrelationData(correlationId);
        rabbitTemplate.convertAndSend(exchangeName, routingKey, payload, correlationData);

        CorrelationData.Confirm confirm = waitForConfirm(correlationData);
        ReturnedMessage returned = correlationData.getReturned();
        if (returned != null) {
            throw new IllegalStateException(
                    "RabbitMQ returned unroutable message. exchange=%s routingKey=%s replyCode=%d replyText=%s"
                            .formatted(
                                    returned.getExchange(),
                                    returned.getRoutingKey(),
                                    returned.getReplyCode(),
                                    returned.getReplyText()
                            )
            );
        }
        if (!confirm.isAck()) {
            throw new IllegalStateException("RabbitMQ publish was negatively acknowledged: " + confirm.getReason());
        }
    }

    private CorrelationData.Confirm waitForConfirm(CorrelationData correlationData) {
        try {
            return correlationData.getFuture().get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for RabbitMQ publisher confirm.", exception);
        } catch (ExecutionException exception) {
            throw new IllegalStateException("Failed while waiting for RabbitMQ publisher confirm.", exception);
        } catch (TimeoutException exception) {
            throw new IllegalStateException("Timed out waiting for RabbitMQ publisher confirm.", exception);
        }
    }
}
