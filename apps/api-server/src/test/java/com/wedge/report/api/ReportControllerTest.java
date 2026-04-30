package com.wedge.report.api;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.application.ReportQueryService;
import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ReportControllerTest {
    private final ReportQueryService reportQueryService = mock(ReportQueryService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ReportController(reportQueryService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();

    @Test
    void listRunReportsReturnsSummaryEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        when(reportQueryService.listRunReportSummaries(runId, userId)).thenReturn(List.of(summary(reportId, runId)));

        mockMvc.perform(get("/api/runs/{runId}/reports", runId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(reportId.toString()))
                .andExpect(jsonPath("$.data[0].frictionScore").value(61.0))
                .andExpect(jsonPath("$.data[0].topFindings").isArray())
                .andExpect(jsonPath("$.meta.requestId").value("req_report_summary"));
    }

    private ReportSummaryResponse summary(UUID reportId, UUID runId) {
        return new ReportSummaryResponse(
                reportId,
                runId,
                UUID.randomUUID(),
                "Landing CTA audit",
                ReportFormat.JSON,
                ReportStatus.READY,
                new BigDecimal("61.0"),
                Map.of("headline", "CTA issue"),
                List.of(Map.of("stage", "CTA")),
                List.of(),
                OffsetDateTime.parse("2026-04-29T12:00:00+09:00")
        );
    }

    private UsernamePasswordAuthenticationToken authentication(UUID userId) {
        WedgePrincipal principal = new WedgePrincipal(userId, "user@example.com", "User");
        return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
    }
}
