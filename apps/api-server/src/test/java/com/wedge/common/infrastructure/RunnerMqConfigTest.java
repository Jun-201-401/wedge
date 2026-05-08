package com.wedge.common.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Queue;

class RunnerMqConfigTest {
    private final RunnerMqConfig config = new RunnerMqConfig();

    @Test
    void runExecuteQueueKeepsDeadLetterArgumentsAlignedWithDevTopology() {
        Queue queue = config.runExecuteQueue("run.execute.request", "wedge.dlq", "run.execute.dlq");

        assertThat(queue.getName()).isEqualTo("run.execute.request");
        assertThat(queue.isDurable()).isTrue();
        assertThat(queue.getArguments())
                .containsEntry("x-dead-letter-exchange", "wedge.dlq")
                .containsEntry("x-dead-letter-routing-key", "run.execute.dlq");
    }

    @Test
    void runExecuteDeadLetterQueueIsDurable() {
        Queue queue = config.runExecuteDeadLetterQueue("run.execute.dlq");

        assertThat(queue.getName()).isEqualTo("run.execute.dlq");
        assertThat(queue.isDurable()).isTrue();
        assertThat(queue.getArguments()).isEmpty();
    }
}
