package com.wedge.discovery.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.discovery.application.DiscoveryService;
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
class DiscoveryExecutionDeadLetterListenerTest {
    @Mock
    private DiscoveryService discoveryService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private DiscoveryExecutionDeadLetterListener listener;

    @BeforeEach
    void setUp() {
        listener = new DiscoveryExecutionDeadLetterListener(objectMapper, discoveryService);
    }

    @Test
    void discoveryExecuteDeadLetterMarksDiscoveryFailedFromPayloadDiscoveryId() throws Exception {
        UUID discoveryId = UUID.randomUUID();
        String body = objectMapper.writeValueAsString(Map.of(
                "messageType", "discovery.execute.request",
                "payload", Map.of("discoveryId", discoveryId.toString())
        ));
        when(discoveryService.markStartFailedIfAwaitingRunner(
                eq(discoveryId),
                eq("DISCOVERY_REQUEST_DEAD_LETTERED"),
                eq("Discovery request could not be delivered to Runner.")
        )).thenReturn(Optional.empty());

        listener.handleDiscoveryExecuteDeadLetter(body);

        verify(discoveryService).markStartFailedIfAwaitingRunner(
                eq(discoveryId),
                eq("DISCOVERY_REQUEST_DEAD_LETTERED"),
                eq("Discovery request could not be delivered to Runner.")
        );
    }

    @Test
    void invalidDiscoveryDeadLetterPayloadIsAckedWithoutFailingDiscovery() {
        listener.handleDiscoveryExecuteDeadLetter("{\"payload\":{\"discoveryId\":\"not-a-uuid\"}}");

        verify(discoveryService, never()).markStartFailedIfAwaitingRunner(any(), any(), any());
    }

    @Test
    void conflictingDiscoveryIdsAreAckedWithoutFailingDiscovery() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "payload", Map.of(
                        "discoveryId", UUID.randomUUID().toString(),
                        "discovery_id", UUID.randomUUID().toString()
                )
        ));

        listener.handleDiscoveryExecuteDeadLetter(body);

        verify(discoveryService, never()).markStartFailedIfAwaitingRunner(any(), any(), any());
    }

    @Test
    void listenerMethodIsBoundToDiscoveryDeadLetterQueue() throws NoSuchMethodException {
        Method method = DiscoveryExecutionDeadLetterListener.class
                .getDeclaredMethod("handleDiscoveryExecuteDeadLetter", String.class);

        assertThat(method.getAnnotation(RabbitListener.class).queues())
                .containsExactly("${wedge.runner.mq.discovery-execute-dead-letter-queue:discovery.execute.dlq}");
    }
}
