package com.wedge.run.infrastructure;

import org.springframework.amqp.core.Queue;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RunMqConfig {
    @Bean
    public Queue runExecuteQueue(
            @Value("${wedge.runner.mq.run-execute-queue:run.execute.request}") String queueName
    ) {
        return new Queue(queueName, true);
    }
}
