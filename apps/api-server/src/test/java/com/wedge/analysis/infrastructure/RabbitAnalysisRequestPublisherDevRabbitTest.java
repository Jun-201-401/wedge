package com.wedge.analysis.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.wedge.common.infrastructure.RabbitConfirmedMessagePublisher;
import com.wedge.analysis.application.AnalysisRequestMessage;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.connection.Connection;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

@Tag("rabbitmq")
@EnabledIfSystemProperty(named = "wedge.rabbit-tests", matches = "true")
class RabbitAnalysisRequestPublisherDevRabbitTest {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void publishSendsEvidencePacketIdToDevAnalysisQueue() throws Exception {
        String queueName = property("wedge.rabbit.queue", "analysis.request");
        String exchangeName = property("wedge.rabbit.exchange", "wedge.direct");
        CachingConnectionFactory connectionFactory = connectionFactory();
        try {
            assumeAnalysisQueueIsSafeToUse(connectionFactory, queueName);
            RabbitTemplate rabbitTemplate = new RabbitTemplate(connectionFactory);
            rabbitTemplate.setReceiveTimeout(5_000L);
            rabbitTemplate.setMandatory(true);
            RabbitAnalysisRequestPublisher publisher = new RabbitAnalysisRequestPublisher(
                    new RabbitConfirmedMessagePublisher(rabbitTemplate, 5_000L),
                    objectMapper,
                    exchangeName,
                    queueName
            );
            UUID runId = UUID.randomUUID();
            UUID analysisJobId = UUID.randomUUID();
            UUID evidencePacketId = UUID.randomUUID();

            publisher.publish(message(runId, analysisJobId, evidencePacketId));

            Object rawMessage = rabbitTemplate.receiveAndConvert(queueName);
            assertThat(rawMessage).isInstanceOf(String.class);
            Map<String, Object> envelope = objectMapper.readValue((String) rawMessage, MAP_TYPE);
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");

            assertThat(envelope)
                    .containsEntry("messageType", "analysis.request")
                    .containsEntry("schemaVersion", "0.5");
            assertThat(payload)
                    .containsEntry("analysisJobId", analysisJobId.toString())
                    .containsEntry("runId", runId.toString())
                    .containsEntry("analysisType", "PRIMARY")
                    .containsEntry("evidencePacketId", evidencePacketId.toString())
                    .doesNotContainKey("evidencePacket");
        } finally {
            connectionFactory.destroy();
        }
    }

    private CachingConnectionFactory connectionFactory() {
        CachingConnectionFactory connectionFactory = new CachingConnectionFactory(
                property("wedge.rabbit.host", "localhost"),
                Integer.parseInt(property("wedge.rabbit.port", "5672"))
        );
        connectionFactory.setUsername(property("wedge.rabbit.username", "ssafy"));
        connectionFactory.setPassword(property("wedge.rabbit.password", "ssafy"));
        connectionFactory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        connectionFactory.setPublisherReturns(true);
        return connectionFactory;
    }

    private void assumeAnalysisQueueIsSafeToUse(CachingConnectionFactory connectionFactory, String queueName) throws Exception {
        Connection connection = connectionFactory.createConnection();
        Channel channel = connection.createChannel(false);
        try {
            AMQP.Queue.DeclareOk queueState = channel.queueDeclarePassive(queueName);
            assumeTrue(queueState.getConsumerCount() == 0, "analysis.request queue has active consumers; skip non-destructive smoke");
            assumeTrue(queueState.getMessageCount() == 0, "analysis.request queue already has messages; skip non-destructive smoke");
        } finally {
            channel.close();
            connection.close();
        }
    }

    private AnalysisRequestMessage message(UUID runId, UUID analysisJobId, UUID evidencePacketId) {
        return new AnalysisRequestMessage(
                UUID.randomUUID().toString(),
                "analysis.request",
                "0.5",
                OffsetDateTime.now().toString(),
                "spring-api",
                runId.toString(),
                "analysis:" + analysisJobId,
                Map.of(
                        "analysisJobId", analysisJobId.toString(),
                        "runId", runId.toString(),
                        "analysisType", "PRIMARY",
                        "forceRebuildEvidenceBundle", false,
                        "evidencePacketId", evidencePacketId.toString()
                )
        );
    }

    private String property(String key, String fallback) {
        return System.getProperty(key, fallback);
    }
}
