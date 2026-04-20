package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wedge.common.error.BusinessException;
import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RunServiceTest {
    private final RunService runService = new RunService();

    @Test
    void createdRunCanBeRetrievedAndStarted() {
        RunResponse created = runService.createRun(sampleRequest());

        assertThat(runService.getRun(created.id()).status()).isEqualTo(RunStatus.CREATED);

        RunResponse queued = runService.startRun(created.id());

        assertThat(queued.status()).isEqualTo(RunStatus.QUEUED);
        assertThat(queued.resultCompleteness()).isEqualTo(ResultCompleteness.NONE);
    }

    @Test
    void missingRunRaisesNotFoundBusinessException() {
        assertThatThrownBy(() -> runService.getRun(UUID.randomUUID()))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Run was not found.");
    }

    @Test
    void invalidTransitionRaisesStateConflict() {
        RunResponse created = runService.createRun(sampleRequest());

        assertThatThrownBy(() -> runService.finishRun(created.id(), false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("CREATED -> COMPLETED");
    }

    private RunCreateRequest sampleRequest() {
        return new RunCreateRequest(
                UUID.randomUUID(),
                "Landing CTA audit",
                URI.create("https://example.com"),
                "무료 체험 CTA까지의 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                null
        );
    }
}
