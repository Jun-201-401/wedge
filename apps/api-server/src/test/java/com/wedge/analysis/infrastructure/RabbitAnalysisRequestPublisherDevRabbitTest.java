package com.wedge.analysis.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.wedge.analysis.application.AnalysisRequestMessage;
import java.time.OffsetDateTime;
import java.util.List;
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
    void publishSendsFullEvidencePacketToDevAnalysisQueue() throws Exception {
        String queueName = property("wedge.rabbit.queue", "analysis.request");
        String exchangeName = property("wedge.rabbit.exchange", "wedge.direct");
        CachingConnectionFactory connectionFactory = connectionFactory();
        try {
            assumeAnalysisQueueIsSafeToUse(connectionFactory, queueName);
            RabbitTemplate rabbitTemplate = new RabbitTemplate(connectionFactory);
            rabbitTemplate.setReceiveTimeout(5_000L);
            RabbitAnalysisRequestPublisher publisher = new RabbitAnalysisRequestPublisher(
                    rabbitTemplate,
                    objectMapper,
                    exchangeName,
                    queueName
            );
            UUID runId = UUID.randomUUID();
            UUID analysisJobId = UUID.randomUUID();

            publisher.publish(message(runId, analysisJobId));

            Object rawMessage = rabbitTemplate.receiveAndConvert(queueName);
            assertThat(rawMessage).isInstanceOf(String.class);
            Map<String, Object> envelope = objectMapper.readValue((String) rawMessage, MAP_TYPE);
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
            @SuppressWarnings("unchecked")
            Map<String, Object> evidencePacket = (Map<String, Object>) payload.get("evidencePacket");

            assertThat(envelope)
                    .containsEntry("messageType", "analysis.request")
                    .containsEntry("schemaVersion", "0.5");
            assertThat(payload)
                    .containsEntry("analysisJobId", analysisJobId.toString())
                    .containsEntry("runId", runId.toString())
                    .containsEntry("analysisType", "PRIMARY")
                    .doesNotContainKey("evidencePacketId");
            assertThat(evidencePacket)
                    .containsEntry("schema_version", "0.5")
                    .containsEntry("execution_type", "RUN")
                    .containsEntry("run_id", runId.toString());
            assertThat((List<?>) evidencePacket.get("checkpoints")).hasSize(1);
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

    private AnalysisRequestMessage message(UUID runId, UUID analysisJobId) {
        Map<String, Object> evidencePacket = Map.of(
                "schema_version", "0.5",
                "execution_type", "RUN",
                "run_id", runId.toString(),
                "url", "https://example.com",
                "scenario", Map.of(),
                "environment", Map.of(),
                "checkpoints", List.of(Map.of(
                        "checkpoint_id", "cp_001",
                        "step_id", "step_001_goto",
                        "primaryStage", "FIRST_VIEW",
                        "trigger", Map.of(),
                        "settle", Map.of(),
                        "state", Map.of(),
                        "observations", List.of(Map.of(
                                "observation_id", "obs_001",
                                "type", "cta_candidate",
                                "stage", "CTA",
                                "source", List.of("dom"),
                                "data", Map.of("target", "text=Start free")
                        )),
                        "deltas", List.of(),
                        "artifact_refs", List.of()
                )),
                "aggregate_signals", Map.of(
                        "checkpoint_count", 1,
                        "observation_count", 1,
                        "artifact_count", 0
                ),
                "artifacts", List.of()
        );
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
                        "evidencePacket", evidencePacket
                )
        );
    }

    private String property(String key, String fallback) {
        return System.getProperty(key, fallback);
    }
}
