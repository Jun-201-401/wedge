package com.wedge.common.infrastructure;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

@ExtendWith(MockitoExtension.class)
class RabbitConfirmedMessagePublisherTest {
    @Mock
    private RabbitTemplate rabbitTemplate;

    @Test
    void convertAndSendReturnsOnlyAfterPositiveConfirm() {
        doAnswer(invocation -> {
            CorrelationData correlationData = invocation.getArgument(3);
            correlationData.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbitTemplate).convertAndSend(eq("wedge.direct"), eq("analysis.request"), eq("payload"), any(CorrelationData.class));
        RabbitConfirmedMessagePublisher publisher = new RabbitConfirmedMessagePublisher(rabbitTemplate, Duration.ofSeconds(1));

        publisher.convertAndSend("wedge.direct", "analysis.request", "payload", "message-1");

        ArgumentCaptor<CorrelationData> captor = ArgumentCaptor.forClass(CorrelationData.class);
        verify(rabbitTemplate).convertAndSend(eq("wedge.direct"), eq("analysis.request"), eq("payload"), captor.capture());
        org.assertj.core.api.Assertions.assertThat(captor.getValue().getId()).isEqualTo("message-1");
    }

    @Test
    void convertAndSendThrowsWhenBrokerNacksPublish() {
        doAnswer(invocation -> {
            CorrelationData correlationData = invocation.getArgument(3);
            correlationData.getFuture().complete(new CorrelationData.Confirm(false, "exchange missing"));
            return null;
        }).when(rabbitTemplate).convertAndSend(eq("wedge.direct"), eq("analysis.request"), eq("payload"), any(CorrelationData.class));
        RabbitConfirmedMessagePublisher publisher = new RabbitConfirmedMessagePublisher(rabbitTemplate, Duration.ofSeconds(1));

        assertThatThrownBy(() -> publisher.convertAndSend("wedge.direct", "analysis.request", "payload", "message-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("negatively acknowledged");
    }

    @Test
    void convertAndSendThrowsWhenMessageIsReturned() {
        doAnswer(invocation -> {
            CorrelationData correlationData = invocation.getArgument(3);
            correlationData.setReturned(new ReturnedMessage(
                    new Message(new byte[0], new MessageProperties()),
                    312,
                    "NO_ROUTE",
                    "wedge.direct",
                    "missing.queue"
            ));
            correlationData.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbitTemplate).convertAndSend(eq("wedge.direct"), eq("missing.queue"), eq("payload"), any(CorrelationData.class));
        RabbitConfirmedMessagePublisher publisher = new RabbitConfirmedMessagePublisher(rabbitTemplate, Duration.ofSeconds(1));

        assertThatThrownBy(() -> publisher.convertAndSend("wedge.direct", "missing.queue", "payload", "message-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unroutable message")
                .hasMessageContaining("NO_ROUTE");
    }

    @Test
    void convertAndSendThrowsWhenConfirmTimesOut() {
        RabbitConfirmedMessagePublisher publisher = new RabbitConfirmedMessagePublisher(rabbitTemplate, Duration.ofMillis(1));

        assertThatThrownBy(() -> publisher.convertAndSend("wedge.direct", "analysis.request", "payload", "message-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Timed out waiting");
    }
}
