package com.wedge.report.api;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wedge.auth.infrastructure.UserAccountMapper;
import com.wedge.common.config.SecurityConfig;
import com.wedge.common.security.InternalServiceTokenFilter;
import com.wedge.common.security.JsonAccessDeniedHandler;
import com.wedge.common.security.JsonAuthenticationEntryPoint;
import com.wedge.common.security.JwtAuthenticationFilter;
import com.wedge.common.security.JwtTokenProvider;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.application.ReportDetailQueryService;
import com.wedge.report.application.ReportExportService;
import com.wedge.report.application.ReportGenerationService;
import com.wedge.report.application.ReportShareService;
import com.wedge.report.application.ReportSummaryQueryService;
import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = ReportController.class)
@Import({
        SecurityConfig.class,
        JwtAuthenticationFilter.class,
        InternalServiceTokenFilter.class,
        JsonAuthenticationEntryPoint.class,
        JsonAccessDeniedHandler.class
})
class ReportSecurityConfigTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ReportSummaryQueryService reportSummaryQueryService;
    @MockBean
    private ReportDetailQueryService reportDetailQueryService;
    @MockBean
    private ReportGenerationService reportGenerationService;
    @MockBean
    private ReportExportService reportExportService;
    @MockBean
    private ReportShareService reportShareService;
    @MockBean
    private JwtTokenProvider jwtTokenProvider;
    @MockBean
    private UserAccountMapper userAccountMapper;

    @Test
    void sharedReportEndpointIsPublicWithoutBearerToken() throws Exception {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(reportShareService.getSharedReport("share-token")).thenReturn(detail(reportId, runId));

        mockMvc.perform(get("/api/report-shares/{shareToken}", "share-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(reportId.toString()));
    }

    @Test
    void sharedReportArtifactContentEndpointIsPublicWithoutBearerToken() throws Exception {
        UUID artifactId = UUID.randomUUID();
        byte[] imageBytes = "fake-png".getBytes();
        when(reportShareService.getSharedArtifactContent("share-token", artifactId))
                .thenReturn(new EvidenceService.ArtifactContent(new ByteArrayResource(imageBytes), "image/png"));

        mockMvc.perform(get("/api/report-shares/{shareToken}/artifacts/{artifactId}/content", "share-token", artifactId))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"))
                .andExpect(content().bytes(imageBytes));
    }

    @Test
    void reportShareManagementEndpointRequiresAuthentication() throws Exception {
        UUID reportId = UUID.randomUUID();

        mockMvc.perform(get("/api/reports/{reportId}/shares", reportId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("unauthorized"));

        verifyNoInteractions(reportShareService);
    }

    @Test
    void nonGetSharedReportEndpointIsNotPubliclyPermitted() throws Exception {
        mockMvc.perform(post("/api/report-shares/{shareToken}", "share-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("unauthorized"));
    }

    @Test
    void unexpectedGetUnderReportSharesIsNotPubliclyPermitted() throws Exception {
        mockMvc.perform(get("/api/report-shares/{shareToken}/unexpected", "share-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("unauthorized"));
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
                List.of(),
                0,
                List.of(),
                OffsetDateTime.parse("2026-05-06T03:00:00Z")
        );
    }
}
