package com.wedge.run.infrastructure;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RunMqConfig {
    @Bean
    public DirectExchange wedgeDirectExchange(
            @Value("${wedge.runner.mq.exchange:wedge.direct}") String exchangeName
    ) {
        return new DirectExchange(exchangeName, true, false);
    }

    @Bean
    public DirectExchange wedgeDeadLetterExchange(
            @Value("${wedge.runner.mq.dead-letter-exchange:wedge.dlq}") String exchangeName
    ) {
        return new DirectExchange(exchangeName, true, false);
    }

    @Bean
    public Queue runExecuteQueue(
            @Value("${wedge.runner.mq.run-execute-queue:run.execute.request}") String queueName,
            @Value("${wedge.runner.mq.dead-letter-exchange:wedge.dlq}") String deadLetterExchange,
            @Value("${wedge.runner.mq.run-execute-dead-letter-routing-key:run.execute.dlq}") String deadLetterRoutingKey
    ) {
        return QueueBuilder.durable(queueName)
                .deadLetterExchange(deadLetterExchange)
                .deadLetterRoutingKey(deadLetterRoutingKey)
                .build();
    }

    @Bean
    public Queue runExecuteDeadLetterQueue(
            @Value("${wedge.runner.mq.run-execute-dead-letter-queue:run.execute.dlq}") String queueName
    ) {
        return QueueBuilder.durable(queueName).build();
    }

    @Bean
    public Binding runExecuteBinding(DirectExchange wedgeDirectExchange, Queue runExecuteQueue) {
        return BindingBuilder.bind(runExecuteQueue).to(wedgeDirectExchange).with(runExecuteQueue.getName());
    }

    @Bean
    public Binding runExecuteDeadLetterBinding(DirectExchange wedgeDeadLetterExchange, Queue runExecuteDeadLetterQueue) {
        return BindingBuilder.bind(runExecuteDeadLetterQueue).to(wedgeDeadLetterExchange).with(runExecuteDeadLetterQueue.getName());
    }
}
