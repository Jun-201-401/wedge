package com.wedge.common.infrastructure;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RunnerMqConfig {
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
    public Queue agentExecuteQueue(
            @Value("${wedge.runner.mq.agent-execute-queue:agent.execute.request}") String queueName,
            @Value("${wedge.runner.mq.dead-letter-exchange:wedge.dlq}") String deadLetterExchange,
            @Value("${wedge.runner.mq.agent-execute-dead-letter-routing-key:agent.execute.dlq}") String deadLetterRoutingKey
    ) {
        return QueueBuilder.durable(queueName)
                .deadLetterExchange(deadLetterExchange)
                .deadLetterRoutingKey(deadLetterRoutingKey)
                .build();
    }

    @Bean
    public Queue agentExecuteDeadLetterQueue(
            @Value("${wedge.runner.mq.agent-execute-dead-letter-queue:agent.execute.dlq}") String queueName
    ) {
        return QueueBuilder.durable(queueName).build();
    }

    @Bean
    public Queue discoveryExecuteQueue(
            @Value("${wedge.runner.mq.discovery-execute-queue:discovery.execute.request}") String queueName,
            @Value("${wedge.runner.mq.dead-letter-exchange:wedge.dlq}") String deadLetterExchange,
            @Value("${wedge.runner.mq.discovery-execute-dead-letter-routing-key:discovery.execute.dlq}") String deadLetterRoutingKey
    ) {
        return QueueBuilder.durable(queueName)
                .deadLetterExchange(deadLetterExchange)
                .deadLetterRoutingKey(deadLetterRoutingKey)
                .build();
    }

    @Bean
    public Queue discoveryExecuteDeadLetterQueue(
            @Value("${wedge.runner.mq.discovery-execute-dead-letter-queue:discovery.execute.dlq}") String queueName
    ) {
        return QueueBuilder.durable(queueName).build();
    }

    @Bean
    public Queue scenarioAuthoringExecuteQueue(
            @Value("${wedge.runner.mq.scenario-authoring-execute-queue:scenario-authoring.execute.request}") String queueName,
            @Value("${wedge.runner.mq.dead-letter-exchange:wedge.dlq}") String deadLetterExchange,
            @Value("${wedge.runner.mq.scenario-authoring-execute-dead-letter-routing-key:scenario-authoring.execute.dlq}") String deadLetterRoutingKey
    ) {
        return QueueBuilder.durable(queueName)
                .deadLetterExchange(deadLetterExchange)
                .deadLetterRoutingKey(deadLetterRoutingKey)
                .build();
    }

    @Bean
    public Queue scenarioAuthoringExecuteDeadLetterQueue(
            @Value("${wedge.runner.mq.scenario-authoring-execute-dead-letter-queue:scenario-authoring.execute.dlq}") String queueName
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

    @Bean
    public Binding agentExecuteBinding(DirectExchange wedgeDirectExchange, Queue agentExecuteQueue) {
        return BindingBuilder.bind(agentExecuteQueue).to(wedgeDirectExchange).with(agentExecuteQueue.getName());
    }

    @Bean
    public Binding agentExecuteDeadLetterBinding(DirectExchange wedgeDeadLetterExchange, Queue agentExecuteDeadLetterQueue) {
        return BindingBuilder.bind(agentExecuteDeadLetterQueue).to(wedgeDeadLetterExchange).with(agentExecuteDeadLetterQueue.getName());
    }

    @Bean
    public Binding discoveryExecuteBinding(DirectExchange wedgeDirectExchange, Queue discoveryExecuteQueue) {
        return BindingBuilder.bind(discoveryExecuteQueue).to(wedgeDirectExchange).with(discoveryExecuteQueue.getName());
    }

    @Bean
    public Binding discoveryExecuteDeadLetterBinding(DirectExchange wedgeDeadLetterExchange, Queue discoveryExecuteDeadLetterQueue) {
        return BindingBuilder.bind(discoveryExecuteDeadLetterQueue).to(wedgeDeadLetterExchange).with(discoveryExecuteDeadLetterQueue.getName());
    }

    @Bean
    public Binding scenarioAuthoringExecuteBinding(DirectExchange wedgeDirectExchange, Queue scenarioAuthoringExecuteQueue) {
        return BindingBuilder.bind(scenarioAuthoringExecuteQueue).to(wedgeDirectExchange).with(scenarioAuthoringExecuteQueue.getName());
    }

    @Bean
    public Binding scenarioAuthoringExecuteDeadLetterBinding(DirectExchange wedgeDeadLetterExchange, Queue scenarioAuthoringExecuteDeadLetterQueue) {
        return BindingBuilder.bind(scenarioAuthoringExecuteDeadLetterQueue).to(wedgeDeadLetterExchange).with(scenarioAuthoringExecuteDeadLetterQueue.getName());
    }
}
