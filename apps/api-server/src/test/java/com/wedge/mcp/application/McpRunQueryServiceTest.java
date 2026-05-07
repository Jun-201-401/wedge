package com.wedge.mcp.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.wedge.mcp.api.dto.GetRunStatusResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class McpRunQueryServiceTest {
    private final RunService runService = org.mockito.Mockito.mock(RunService.class);
    private final McpRunQueryService mcpRunQueryService = new McpRunQueryService(runService);

    @Test
    void getRunStatusReturnsLightweightRunState() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID scenarioTemplateVersionId = UUID.randomUUID();
        RunResponse run = new RunResponse(
                runId,
                "run",
                projectId,
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "CTA flow",
                "desktop",
                scenarioTemplateVersionId,
                RunStatus.RUNNING,
                ResultCompleteness.NONE,
                AnalysisStatus.NOT_STARTED,
                2,
                OffsetDateTime.parse("2026-05-06T10:00:00+09:00"),
                null,
                null,
                null,
                null
        );

        when(runService.getRun(runId)).thenReturn(run);

        GetRunStatusResponse response = mcpRunQueryService.getRunStatus(runId);

        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.projectId()).isEqualTo(projectId);
        assertThat(response.scenarioTemplateVersionId()).isEqualTo(scenarioTemplateVersionId);
        assertThat(response.status()).isEqualTo(RunStatus.RUNNING);
        assertThat(response.resultCompleteness()).isEqualTo(ResultCompleteness.NONE);
        assertThat(response.analysisStatus()).isEqualTo(AnalysisStatus.NOT_STARTED);
        assertThat(response.currentStepOrder()).isEqualTo(2);
        assertThat(response.startUrl()).isEqualTo("https://example.com");
        assertThat(response.failure()).isNull();
    }
}
