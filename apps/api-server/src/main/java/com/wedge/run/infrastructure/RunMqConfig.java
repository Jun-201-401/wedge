package com.wedge.run.infrastructure;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
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
    public Queue runExecuteQueue(
            @Value("${wedge.runner.mq.run-execute-queue:run.execute.request}") String queueName
    ) {
        return new Queue(queueName, true);
    }

    @Bean
    public Binding runExecuteBinding(DirectExchange wedgeDirectExchange, Queue runExecuteQueue) {
        return BindingBuilder.bind(runExecuteQueue).to(wedgeDirectExchange).with(runExecuteQueue.getName());
    }
}
