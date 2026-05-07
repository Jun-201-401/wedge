package com.wedge.mcp.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.mcp.api.dto.GetRunStatusResponse;
import com.wedge.mcp.application.McpRunQueryService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WedgeRunMcpToolsTest {
    private final McpRunQueryService mcpRunQueryService = org.mockito.Mockito.mock(McpRunQueryService.class);
    private final WedgeRunMcpTools tools = new WedgeRunMcpTools(mcpRunQueryService);

    @Test
    void getRunStatusDelegatesWithParsedUuid() {
        UUID runId = UUID.randomUUID();
        GetRunStatusResponse expected = new GetRunStatusResponse(
                runId,
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                "https://example.com",
                "CTA flow",
                "desktop",
                UUID.randomUUID(),
                RunStatus.COMPLETED,
                ResultCompleteness.FINAL,
                AnalysisStatus.COMPLETED,
                3,
                null,
                null,
                null
        );
        when(mcpRunQueryService.getRunStatus(runId)).thenReturn(expected);

        GetRunStatusResponse response = tools.getRunStatus(runId.toString());

        assertThat(response).isEqualTo(expected);
    }

    @Test
    void getRunStatusRejectsInvalidUuid() {
        assertThatThrownBy(() -> tools.getRunStatus("not-a-uuid"))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST))
                .hasMessage("runId must be a valid UUID.");

        verifyNoInteractions(mcpRunQueryService);
    }

    @Test
    void getRunStatusRejectsBlankRunId() {
        assertThatThrownBy(() -> tools.getRunStatus(" "))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST))
                .hasMessage("runId is required.");

        verifyNoInteractions(mcpRunQueryService);
    }
}
