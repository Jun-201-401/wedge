package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wedge.common.error.BusinessException;
import com.wedge.run.domain.RunStatus;
import org.junit.jupiter.api.Test;

class RunStatusTransitionPolicyTest {

    @Test
    void allowsCreatedRunToQueueForExecution() {
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.CREATED, RunStatus.QUEUED)).isTrue();
    }

    @Test
    void allowsFailureBeforeBrowserExecutionStarts() {
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.QUEUED, RunStatus.FAILED)).isTrue();
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.STARTING, RunStatus.FAILED)).isTrue();
    }

    @Test
    void allowsRunnerReportedStopFromRunning() {
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.RUNNING, RunStatus.STOPPED)).isTrue();
    }

    @Test
    void rejectsSkippingDirectlyFromCreatedToCompleted() {
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.CREATED, RunStatus.COMPLETED)).isFalse();
        assertThatThrownBy(() -> RunStatusTransitionPolicy.validateTransition(RunStatus.CREATED, RunStatus.COMPLETED))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("CREATED -> COMPLETED");
    }

    @Test
    void rejectsTerminalRunRestart() {
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.COMPLETED, RunStatus.RUNNING)).isFalse();
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.FAILED, RunStatus.RUNNING)).isFalse();
        assertThat(RunStatusTransitionPolicy.canTransition(RunStatus.STOPPED, RunStatus.RUNNING)).isFalse();
    }
}
