package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportShareResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.report.domain.ReportShare;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.report.infrastructure.ReportShareMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ReportStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;

@ExtendWith(MockitoExtension.class)
class ReportShareServiceTest {
    private static final Instant FIXED_INSTANT = Instant.parse("2026-05-06T03:00:00Z");
    private static final OffsetDateTime NOW = OffsetDateTime.ofInstant(FIXED_INSTANT, ZoneOffset.UTC);
    private static final String SHARE_TOKEN = "share-token";

    @Mock
    private ReportMapper reportMapper;
    @Mock
    private ReportShareMapper reportShareMapper;
    @Mock
    private RunService runService;
    @Mock
    private ReportAccessGuard reportAccessGuard;
    @Mock
    private ReportDetailQueryService reportDetailQueryService;
    @Mock
    private EvidenceService evidenceService;
    @Mock
    private ReportShareTokenGenerator tokenGenerator;

    private ReportProperties reportProperties;
    private ReportShareService reportShareService;

    @BeforeEach
    void setUp() {
        reportProperties = new ReportProperties();
        reportProperties.setPublicBaseUrl("https://wedge.example.com/");
        reportProperties.setShareDefaultExpirationMinutes(10);
        reportShareService = new ReportShareService(
                reportMapper,
                reportShareMapper,
                runService,
                reportAccessGuard,
                reportDetailQueryService,
                evidenceService,
                reportProperties,
                tokenGenerator,
                Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC)
        );
    }

    @Test
    void createReportShareUsesTenMinuteDefaultExpiration() {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportMapper.findById(reportId)).thenReturn(Optional.of(report(reportId, runId)));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, projectId));
        when(reportShareMapper.lockReportForShare(reportId)).thenReturn(Optional.of(reportId));
        when(reportShareMapper.findActiveByReportId(reportId, NOW)).thenReturn(Optional.empty());
        when(tokenGenerator.generate()).thenReturn(SHARE_TOKEN);

        ReportShareCreationResult result = reportShareService.createReportShare(reportId, userId);

        ArgumentCaptor<ReportShare> shareCaptor = ArgumentCaptor.forClass(ReportShare.class);
        verify(reportShareMapper).insert(shareCaptor.capture());
        ReportShare inserted = shareCaptor.getValue();
        ReportShareResponse response = result.response();
        assertThat(result.created()).isTrue();
        assertThat(inserted.getReportId()).isEqualTo(reportId);
        assertThat(inserted.getShareToken()).isEqualTo(SHARE_TOKEN);
        assertThat(inserted.getAccessLevel()).isEqualTo("VIEW");
        assertThat(inserted.getExpiresAt()).isEqualTo(NOW.plusMinutes(10));
        assertThat(inserted.getCreatedAt()).isEqualTo(NOW);
        assertThat(inserted.getCreatedBy()).isEqualTo(userId);
        assertThat(response.shareUrl()).isEqualTo("https://wedge.example.com/api/report-shares/" + SHARE_TOKEN);
        assertThat(response.expiresAt()).isEqualTo(NOW.plusMinutes(10));
        assertThat(response.createdAt()).isEqualTo(NOW);
        verify(reportAccessGuard).ensureProjectAccessible(projectId, userId);
        InOrder inOrder = inOrder(reportShareMapper);
        inOrder.verify(reportShareMapper).lockReportForShare(reportId);
        inOrder.verify(reportShareMapper).findActiveByReportId(reportId, NOW);
        inOrder.verify(reportShareMapper).insert(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void createReportShareReusesExistingActiveShare() {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        ReportShare activeShare = share(reportId);
        when(reportMapper.findById(reportId)).thenReturn(Optional.of(report(reportId, runId)));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, projectId));
        when(reportShareMapper.lockReportForShare(reportId)).thenReturn(Optional.of(reportId));
        when(reportShareMapper.findActiveByReportId(reportId, NOW)).thenReturn(Optional.of(activeShare));

        ReportShareCreationResult result = reportShareService.createReportShare(reportId, userId);

        ReportShareResponse response = result.response();
        assertThat(result.created()).isFalse();
        assertThat(response.id()).isEqualTo(activeShare.getId());
        assertThat(response.reportId()).isEqualTo(reportId);
        assertThat(response.shareUrl()).isEqualTo("https://wedge.example.com/api/report-shares/" + SHARE_TOKEN);
        assertThat(response.expiresAt()).isEqualTo(activeShare.getExpiresAt());
        verify(tokenGenerator, never()).generate();
        verify(reportShareMapper, never()).insert(org.mockito.ArgumentMatchers.any());
        verify(reportAccessGuard).ensureProjectAccessible(projectId, userId);
        InOrder inOrder = inOrder(reportShareMapper);
        inOrder.verify(reportShareMapper).lockReportForShare(reportId);
        inOrder.verify(reportShareMapper).findActiveByReportId(reportId, NOW);
    }

    @Test
    void getSharedReportReturnsDetailForActiveToken() {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        ReportShare share = share(reportId);
        ReportDetailResponse detail = detail(reportId, runId);
        when(reportShareMapper.findActiveByToken(SHARE_TOKEN, NOW)).thenReturn(Optional.of(share));
        when(reportDetailQueryService.getSharedReportDetail(reportId)).thenReturn(detail);

        ReportDetailResponse response = reportShareService.getSharedReport(SHARE_TOKEN);

        assertThat(response).isSameAs(detail);
    }

    @Test
    void getSharedReportRejectsMissingExpiredOrRevokedToken() {
        when(reportShareMapper.findActiveByToken(SHARE_TOKEN, NOW)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportShareService.getSharedReport(SHARE_TOKEN))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.REPORT_NOT_FOUND)
                );
    }

    @Test
    void getSharedArtifactContentReturnsRunArtifactForActiveToken() {
        UUID reportId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        ReportShare share = share(reportId);
        EvidenceService.ArtifactContent content = new EvidenceService.ArtifactContent(
                new ByteArrayResource("fake-png".getBytes()),
                "image/png",
                "artifact.png"
        );
        when(reportShareMapper.findActiveByToken(SHARE_TOKEN, NOW)).thenReturn(Optional.of(share));
        when(reportMapper.findById(reportId)).thenReturn(Optional.of(report(reportId, runId)));
        when(evidenceService.getRunImageArtifactContent(runId, artifactId)).thenReturn(content);

        EvidenceService.ArtifactContent response = reportShareService.getSharedArtifactContent(SHARE_TOKEN, artifactId);

        assertThat(response).isSameAs(content);
        verify(evidenceService).getRunImageArtifactContent(runId, artifactId);
    }


    @Test
    void getSharedArtifactContentRejectsWhenActiveTokenPointsToDeletedReport() {
        UUID reportId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(reportShareMapper.findActiveByToken(SHARE_TOKEN, NOW)).thenReturn(Optional.of(share(reportId)));
        when(reportMapper.findById(reportId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportShareService.getSharedArtifactContent(SHARE_TOKEN, artifactId))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.REPORT_NOT_FOUND)
                );

        verify(evidenceService, never()).getRunImageArtifactContent(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void getSharedArtifactContentRejectsMissingExpiredOrRevokedToken() {
        UUID artifactId = UUID.randomUUID();
        when(reportShareMapper.findActiveByToken(SHARE_TOKEN, NOW)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportShareService.getSharedArtifactContent(SHARE_TOKEN, artifactId))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.REPORT_NOT_FOUND)
                );

        verify(evidenceService, never()).getRunImageArtifactContent(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void revokeReportShareMarksShareRevoked() {
        UUID reportId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportMapper.findById(reportId)).thenReturn(Optional.of(report(reportId, runId)));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(reportShareMapper.revoke(shareId, reportId, NOW)).thenReturn(1);

        reportShareService.revokeReportShare(reportId, shareId, userId);

        verify(reportShareMapper).revoke(shareId, reportId, NOW);
    }

    @Test
    void revokeReportShareThrowsNotFoundWhenNoShareWasUpdated() {
        UUID reportId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportMapper.findById(reportId)).thenReturn(Optional.of(report(reportId, runId)));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(reportShareMapper.revoke(shareId, reportId, NOW)).thenReturn(0);

        assertThatThrownBy(() -> reportShareService.revokeReportShare(reportId, shareId, userId))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.REPORT_NOT_FOUND)
                );
    }

    private Report report(UUID reportId, UUID runId) {
        Report report = new Report();
        report.setId(reportId);
        report.setRunId(runId);
        report.setAnalysisJobId(UUID.randomUUID());
        report.setTitle("Landing CTA audit");
        report.setFormat(ReportFormat.JSON);
        report.setStatus(ReportStatus.READY);
        report.setCreatedAt(NOW.minusMinutes(1));
        return report;
    }

    private ReportShare share(UUID reportId) {
        ReportShare share = new ReportShare();
        share.setId(UUID.randomUUID());
        share.setReportId(reportId);
        share.setShareToken(SHARE_TOKEN);
        share.setAccessLevel("VIEW");
        share.setExpiresAt(NOW.plusMinutes(10));
        share.setCreatedAt(NOW);
        return share;
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
                NOW
        );
    }

    private RunResponse runResponse(UUID runId, UUID projectId) {
        return new RunResponse(
                runId,
                "run",
                projectId,
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "CTA audit",
                "desktop",
                null,
                RunStatus.COMPLETED,
                ResultCompleteness.FINAL,
                AnalysisStatus.COMPLETED,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
