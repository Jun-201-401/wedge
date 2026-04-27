package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

class RunExecuteOutboxDispatcherTest {

    @Test
    void outboxEventListenerUsesNewTransactionAfterCommit() throws NoSuchMethodException {
        Method handle = RunExecuteOutboxDispatcher.class.getDeclaredMethod(
                "handle",
                RunExecuteOutboxEnqueuedEvent.class
        );

        Transactional transactional = handle.getAnnotation(Transactional.class);
        TransactionalEventListener eventListener = handle.getAnnotation(TransactionalEventListener.class);

        assertThat(eventListener).isNotNull();
        assertThat(transactional).isNotNull();
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }
}
