package com.wedge.report.api;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.report.api.dto.DecisionMapItemResponse;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.api.dto.RunReportResponse;
import com.wedge.report.application.ReportDetailQueryService;
import com.wedge.report.application.ReportGenerationService;
import com.wedge.report.application.ReportSummaryQueryService;
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
    private final ReportSummaryQueryService reportSummaryQueryService = mock(ReportSummaryQueryService.class);
    private final ReportDetailQueryService reportDetailQueryService = mock(ReportDetailQueryService.class);
    private final ReportGenerationService reportGenerationService = mock(ReportGenerationService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(
                    new ReportController(reportSummaryQueryService, reportDetailQueryService, reportGenerationService)
            )
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();

    @Test
    void listRunReportsReturnsSummaryEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        when(reportSummaryQueryService.listRunReportSummaries(runId, userId)).thenReturn(List.of(summary(reportId, runId)));

        mockMvc.perform(get("/api/runs/{runId}/reports", runId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(reportId.toString()))
                .andExpect(jsonPath("$.data[0].frictionScore").value(61.0))
                .andExpect(jsonPath("$.data[0].topFindings").isArray())
                .andExpect(jsonPath("$.meta.requestId").value("req_report_summary"));
    }

    @Test
    void generateRunReportReturnsCreatedEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        when(reportGenerationService.generateRunReport(runId, userId)).thenReturn(runReport(runId, reportId));

        mockMvc.perform(post("/api/runs/{runId}/report", runId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_generate"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.reportId").value(reportId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value("req_report_generate"));
    }

    @Test
    void getRunReportReturnsProjectionEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        when(reportGenerationService.getRunReport(runId, userId)).thenReturn(runReport(runId, reportId));

        mockMvc.perform(get("/api/runs/{runId}/report", runId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_run_report"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.reportStatus").value("READY"))
                .andExpect(jsonPath("$.data.reportId").value(reportId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_report"));
    }

    @Test
    void getReportReturnsDetailEnvelope() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportDetailQueryService.getReportDetail(reportId, userId)).thenReturn(detail(reportId, runId));

        mockMvc.perform(get("/api/reports/{reportId}", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_detail"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(reportId.toString()))
                .andExpect(jsonPath("$.data.initialDisplayCount").value(3))
                .andExpect(jsonPath("$.data.findings[0].title").value("CTA issue"))
                .andExpect(jsonPath("$.data.findings[0].nudges[0].title").value("Make CTA clearer"))
                .andExpect(jsonPath("$.meta.requestId").value("req_report_detail"));
    }

    @Test
    void getReportReturnsNotFoundWhenReportDoesNotExist() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportDetailQueryService.getReportDetail(reportId, userId))
                .thenThrow(new BusinessException(ErrorCode.REPORT_NOT_FOUND));

        mockMvc.perform(get("/api/reports/{reportId}", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_missing"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("report_not_found"))
                .andExpect(jsonPath("$.meta.requestId").value("req_report_missing"));
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
                List.of(decisionMapItem()),
                List.of(),
                OffsetDateTime.parse("2026-04-29T12:00:00+09:00")
        );
    }

    private ReportDetailResponse detail(UUID reportId, UUID runId) {
        return new ReportDetailResponse(
                reportId,
                runId,
                UUID.randomUUID(),
                "Landing CTA audit",
                ReportFormat.JSON,
                ReportStatus.READY,
                new BigDecimal("61.0"),
                Map.of("headline", "CTA issue"),
                List.of(decisionMapItem()),
                3,
                List.of(detailFinding()),
                OffsetDateTime.parse("2026-04-29T12:00:00+09:00")
        );
    }

    private ReportDetailFindingResponse detailFinding() {
        return new ReportDetailFindingResponse(
                UUID.randomUUID(),
                1,
                "CTA issue",
                "CTA is unclear.",
                "conversion",
                "CTA",
                "clarity",
                2,
                new BigDecimal("0.87"),
                new BigDecimal("9.2"),
                "Users may miss the next action.",
                List.of(Map.of("ref", "cp_001.obs_001")),
                null,
                List.of(detailNudge())
        );
    }

    private DecisionMapItemResponse decisionMapItem() {
        return new DecisionMapItemResponse(
                "CTA",
                "행동 선택",
                "WARNING",
                List.of("issue_001"),
                "CTA가 경쟁합니다.",
                List.of("cp_001.obs_001")
        );
    }

    private ReportDetailNudgeResponse detailNudge() {
        return new ReportDetailNudgeResponse(
                UUID.randomUUID(),
                1,
                "Make CTA clearer",
                "The current label is ambiguous.",
                "Use a direct action label.",
                "LOW",
                "Users understand the next step faster.",
                "Does the click-through rate improve?"
        );
    }

    private RunReportResponse runReport(UUID runId, UUID reportId) {
        return new RunReportResponse(
                runId,
                "READY",
                "COMPLETED",
                UUID.randomUUID(),
                reportId,
                "Landing CTA audit",
                ReportFormat.JSON,
                ReportStatus.READY,
                null,
                null,
                List.of(),
                List.of(),
                null,
                null,
                OffsetDateTime.parse("2026-04-29T12:00:00+09:00"),
                OffsetDateTime.parse("2026-04-29T12:00:00+09:00")
        );
    }

    private UsernamePasswordAuthenticationToken authentication(UUID userId) {
        WedgePrincipal principal = new WedgePrincipal(userId, "user@example.com", "User");
        return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
    }
}
