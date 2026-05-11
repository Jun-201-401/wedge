package com.wedge.report.api;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.report.api.dto.DecisionMapItemResponse;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportShareResponse;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.api.dto.RunReportResponse;
import com.wedge.report.application.ReportDetailQueryService;
import com.wedge.report.application.ReportGenerationService;
import com.wedge.report.application.ReportShareCreationResult;
import com.wedge.report.application.ReportShareService;
import com.wedge.report.application.ReportSummaryQueryService;
import com.wedge.report.domain.ReportFormat;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.run.domain.ReportStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.http.converter.ResourceHttpMessageConverter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ReportControllerTest {
    private static final String REPORT_TITLE = "Landing CTA audit";
    private static final String FINDING_TITLE = "CTA issue";
    private static final String NUDGE_TITLE = "Make CTA clearer";
    private static final String SUMMARY_REQUEST_ID = "req_report_summary";
    private static final String GENERATE_REQUEST_ID = "req_report_generate";
    private static final String RUN_REPORT_REQUEST_ID = "req_run_report";
    private static final String DETAIL_REQUEST_ID = "req_report_detail";
    private static final String MISSING_REPORT_REQUEST_ID = "req_report_missing";
    private static final BigDecimal FRICTION_SCORE = new BigDecimal("61.0");
    private static final OffsetDateTime CREATED_AT = OffsetDateTime.parse("2026-04-29T12:00:00+09:00");
    private static final int INITIAL_DISPLAY_COUNT = 3;
    private static final MappingJackson2HttpMessageConverter JSON_CONVERTER = new MappingJackson2HttpMessageConverter(
            new ObjectMapper()
                    .findAndRegisterModules()
                    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    );

    private final ReportSummaryQueryService reportSummaryQueryService = mock(ReportSummaryQueryService.class);
    private final ReportDetailQueryService reportDetailQueryService = mock(ReportDetailQueryService.class);
    private final ReportGenerationService reportGenerationService = mock(ReportGenerationService.class);
    private final ReportShareService reportShareService = mock(ReportShareService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(
                    new ReportController(
                            reportSummaryQueryService,
                            reportDetailQueryService,
                            reportGenerationService,
                            reportShareService
                    )
            )
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(JSON_CONVERTER, new ResourceHttpMessageConverter())
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
                        .header("X-Request-Id", SUMMARY_REQUEST_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(reportId.toString()))
                .andExpect(jsonPath("$.data[0].frictionScore").value(61.0))
                .andExpect(jsonPath("$.data[0].topFindings").isArray())
                .andExpect(jsonPath("$.meta.requestId").value(SUMMARY_REQUEST_ID));
    }

    @Test
    void generateRunReportReturnsCreatedEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        when(reportGenerationService.generateRunReport(runId, userId)).thenReturn(runReport(runId, reportId));

        mockMvc.perform(post("/api/runs/{runId}/report", runId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", GENERATE_REQUEST_ID))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.reportId").value(reportId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value(GENERATE_REQUEST_ID));
    }

    @Test
    void getRunReportReturnsProjectionEnvelope() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        when(reportGenerationService.getRunReport(runId, userId)).thenReturn(runReport(runId, reportId));

        mockMvc.perform(get("/api/runs/{runId}/report", runId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", RUN_REPORT_REQUEST_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.reportStatus").value("READY"))
                .andExpect(jsonPath("$.data.reportId").value(reportId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value(RUN_REPORT_REQUEST_ID));
    }

    @Test
    void getReportReturnsDetailEnvelope() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportDetailQueryService.getReportDetail(reportId, userId)).thenReturn(detail(reportId, runId));

        mockMvc.perform(get("/api/reports/{reportId}", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", DETAIL_REQUEST_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(reportId.toString()))
                .andExpect(jsonPath("$.data.initialDisplayCount").value(INITIAL_DISPLAY_COUNT))
                .andExpect(jsonPath("$.data.findings[0].title").value(FINDING_TITLE))
                .andExpect(jsonPath("$.data.findings[0].nudges[0].title").value(NUDGE_TITLE))
                .andExpect(jsonPath("$.meta.requestId").value(DETAIL_REQUEST_ID));
    }

    @Test
    void getReportReturnsNotFoundWhenReportDoesNotExist() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportDetailQueryService.getReportDetail(reportId, userId))
                .thenThrow(new BusinessException(ErrorCode.REPORT_NOT_FOUND));

        mockMvc.perform(get("/api/reports/{reportId}", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", MISSING_REPORT_REQUEST_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("report_not_found"))
                .andExpect(jsonPath("$.meta.requestId").value(MISSING_REPORT_REQUEST_ID));
    }

    @Test
    void listReportSharesReturnsShareEnvelope() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        when(reportShareService.listReportShares(reportId, userId)).thenReturn(List.of(share(reportId, shareId)));

        mockMvc.perform(get("/api/reports/{reportId}/shares", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_shares"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(shareId.toString()))
                .andExpect(jsonPath("$.data[0].reportId").value(reportId.toString()))
                .andExpect(jsonPath("$.data[0].shareUrl").value("https://wedge.example.com/api/report-shares/share-token"))
                .andExpect(jsonPath("$.meta.requestId").value("req_report_shares"));
    }

    @Test
    void createReportShareReturnsCreatedEnvelope() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        OffsetDateTime expiresAt = CREATED_AT.plusMinutes(10);
        ReportShareResponse response = new ReportShareResponse(
                shareId,
                reportId,
                "https://wedge.example.com/api/report-shares/share-token",
                "VIEW",
                expiresAt,
                null,
                CREATED_AT
        );
        when(reportShareService.createReportShare(reportId, userId)).thenReturn(ReportShareCreationResult.created(response));

        mockMvc.perform(post("/api/reports/{reportId}/shares", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_share_create"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(shareId.toString()))
                .andExpect(jsonPath("$.data.accessLevel").value("VIEW"))
                .andExpect(jsonPath("$.data.expiresAt").exists())
                .andExpect(jsonPath("$.meta.requestId").value("req_report_share_create"));
    }

    @Test
    void createReportShareReturnsOkEnvelopeWhenExistingActiveShareIsReused() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        ReportShareResponse response = share(reportId, shareId);
        when(reportShareService.createReportShare(reportId, userId)).thenReturn(ReportShareCreationResult.reused(response));

        mockMvc.perform(post("/api/reports/{reportId}/shares", reportId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_share_reuse"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(shareId.toString()))
                .andExpect(jsonPath("$.data.shareUrl").value("https://wedge.example.com/api/report-shares/share-token"))
                .andExpect(jsonPath("$.meta.requestId").value("req_report_share_reuse"));
    }

    @Test
    void revokeReportShareReturnsNoDataEnvelope() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        mockMvc.perform(delete("/api/reports/{reportId}/shares/{shareId}", reportId, shareId)
                        .principal(authentication(userId))
                        .header("X-Request-Id", "req_report_share_revoke"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.meta.requestId").value("req_report_share_revoke"));

        verify(reportShareService).revokeReportShare(reportId, shareId, userId);
    }

    @Test
    void getSharedReportReturnsDetailWithoutPrincipal() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(reportShareService.getSharedReport("share-token")).thenReturn(detail(reportId, runId));

        mockMvc.perform(get("/api/report-shares/{shareToken}", "share-token")
                        .header("X-Request-Id", "req_shared_report"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(reportId.toString()))
                .andExpect(jsonPath("$.data.findings[0].title").value(FINDING_TITLE))
                .andExpect(jsonPath("$.meta.requestId").value("req_shared_report"));
    }

    @Test
    void getSharedReportArtifactContentReturnsImageWithoutPrincipal() throws Exception {
        UUID artifactId = UUID.randomUUID();
        byte[] imageBytes = "fake-png".getBytes();
        when(reportShareService.getSharedArtifactContent("share-token", artifactId))
                .thenReturn(new EvidenceService.ArtifactContent(new ByteArrayResource(imageBytes), "image/png"));

        mockMvc.perform(get("/api/report-shares/{shareToken}/artifacts/{artifactId}/content", "share-token", artifactId))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"))
                .andExpect(content().bytes(imageBytes));

        verify(reportShareService).getSharedArtifactContent("share-token", artifactId);
    }

    private ReportSummaryResponse summary(UUID reportId, UUID runId) {
        return new ReportSummaryResponse(
                reportId,
                runId,
                UUID.randomUUID(),
                REPORT_TITLE,
                ReportFormat.JSON,
                ReportStatus.READY,
                FRICTION_SCORE,
                summaryPayload(),
                List.of(decisionMapItem()),
                List.of(),
                CREATED_AT
        );
    }

    private ReportShareResponse share(UUID reportId, UUID shareId) {
        return new ReportShareResponse(
                shareId,
                reportId,
                "https://wedge.example.com/api/report-shares/share-token",
                "VIEW",
                CREATED_AT.plusMinutes(10),
                null,
                CREATED_AT
        );
    }

    private ReportDetailResponse detail(UUID reportId, UUID runId) {
        return new ReportDetailResponse(
                reportId,
                runId,
                UUID.randomUUID(),
                REPORT_TITLE,
                ReportFormat.JSON,
                ReportStatus.READY,
                FRICTION_SCORE,
                summaryPayload(),
                List.of(decisionMapItem()),
                INITIAL_DISPLAY_COUNT,
                List.of(detailFinding()),
                CREATED_AT
        );
    }

    private ReportDetailFindingResponse detailFinding() {
        return new ReportDetailFindingResponse(
                UUID.randomUUID(),
                1,
                FINDING_TITLE,
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
                NUDGE_TITLE,
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
                REPORT_TITLE,
                ReportFormat.JSON,
                ReportStatus.READY,
                null,
                null,
                List.of(),
                List.of(),
                null,
                null,
                CREATED_AT,
                CREATED_AT
        );
    }

    private Map<String, Object> summaryPayload() {
        return Map.of("headline", FINDING_TITLE);
    }

    private UsernamePasswordAuthenticationToken authentication(UUID userId) {
        WedgePrincipal principal = new WedgePrincipal(userId, "user@example.com", "User");
        return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
    }
}
