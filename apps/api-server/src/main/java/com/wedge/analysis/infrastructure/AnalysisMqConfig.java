package com.wedge.analysis.infrastructure;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AnalysisMqConfig {
    @Bean
    public Queue analysisRequestQueue(
            @Value("${wedge.analyzer.mq.analysis-request-queue:analysis.request}") String queueName,
            @Value("${wedge.analyzer.mq.dead-letter-exchange:wedge.dlq}") String deadLetterExchange,
            @Value("${wedge.analyzer.mq.analysis-dead-letter-routing-key:analysis.dlq}") String deadLetterRoutingKey
    ) {
        return QueueBuilder.durable(queueName)
                .deadLetterExchange(deadLetterExchange)
                .deadLetterRoutingKey(deadLetterRoutingKey)
                .build();
    }

    @Bean
    public Queue analysisDeadLetterQueue(
            @Value("${wedge.analyzer.mq.analysis-dead-letter-queue:analysis.dlq}") String queueName
    ) {
        return QueueBuilder.durable(queueName).build();
    }

    @Bean
    public Binding analysisRequestBinding(DirectExchange wedgeDirectExchange, Queue analysisRequestQueue) {
        return BindingBuilder.bind(analysisRequestQueue).to(wedgeDirectExchange).with(analysisRequestQueue.getName());
    }

    @Bean
    public Binding analysisDeadLetterBinding(DirectExchange wedgeDeadLetterExchange, Queue analysisDeadLetterQueue) {
        return BindingBuilder.bind(analysisDeadLetterQueue).to(wedgeDeadLetterExchange).with(analysisDeadLetterQueue.getName());
    }
}
