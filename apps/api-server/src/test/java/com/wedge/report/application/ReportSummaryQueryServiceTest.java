package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.ReportStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.env.MockEnvironment;

@ExtendWith(MockitoExtension.class)
class ReportSummaryQueryServiceTest {
    @Mock
    private ReportMapper reportMapper;
    @Mock
    private AnalysisFindingMapper analysisFindingMapper;
    @Mock
    private ArtifactMapper artifactMapper;
    @Mock
    private RunService runService;
    @Mock
    private ProjectAccessService projectAccessService;

    private ReportSummaryQueryService reportSummaryQueryService;

    @BeforeEach
    void setUp() {
        reportSummaryQueryService = summaryQueryService(true);
    }

    @Test
    void listRunReportSummariesIncludesTopThreeFindingsAndStagePreview() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        Report report = report(runId, analysisJobId, null);
        AnalysisFinding finding = finding(1, "CTA", new BigDecimal("9.2"));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, projectId));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(analysisFindingMapper.findTopByAnalysisJobId(analysisJobId, 3)).thenReturn(List.of(finding));
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "CTA"))
                .thenReturn(Optional.of(screenshot(runId, "stage/cta.png")));

        List<ReportSummaryResponse> responses = reportSummaryQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses).hasSize(1);
        assertThat(responses.get(0).frictionScore()).isEqualByComparingTo(new BigDecimal("61.0"));
        assertThat(responses.get(0).decisionMap()).isInstanceOf(List.class);
        assertThat(responses.get(0).topFindings().get(0).previewImage().source()).isEqualTo("STAGE_SCREENSHOT");
        verify(projectAccessService).ensureProjectAccessible(projectId, userId);
    }

    @Test
    void topFindingsExcludeFindingWithoutValidStage() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        Report report = report(runId, analysisJobId, null);
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(analysisFindingMapper.findTopByAnalysisJobId(analysisJobId, 3))
                .thenReturn(List.of(finding(1, null, new BigDecimal("9.2")), finding(2, "CTA", new BigDecimal("8.1"))));
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "CTA")).thenReturn(Optional.empty());
        when(artifactMapper.findLatestScreenshotByRunId(runId)).thenReturn(Optional.empty());

        List<ReportSummaryResponse> responses = reportSummaryQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses.get(0).topFindings()).singleElement()
                .satisfies(topFinding -> assertThat(topFinding.stage()).isEqualTo("CTA"));
        verify(artifactMapper, never()).findLatestScreenshotByRunIdAndStage(runId, null);
    }

    @Test
    void listRunReportSummariesCanSkipProjectAccessForMvpMode() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        reportSummaryQueryService = summaryQueryService(false);
        when(runService.getRun(runId)).thenReturn(runResponse(runId, projectId));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of());

        List<ReportSummaryResponse> responses = reportSummaryQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses).isEmpty();
        verify(projectAccessService, never()).ensureProjectAccessible(projectId, userId);
    }

    @Test
    void listRunReportSummariesDoesNotSkipProjectAccessOutsideDevProfile() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        reportSummaryQueryService = summaryQueryService(false, "prod");
        when(runService.getRun(runId)).thenReturn(runResponse(runId, projectId));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of());

        List<ReportSummaryResponse> responses = reportSummaryQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses).isEmpty();
        verify(projectAccessService).ensureProjectAccessible(projectId, userId);
    }

    private ReportSummaryQueryService summaryQueryService(boolean accessCheckEnabled) {
        return summaryQueryService(accessCheckEnabled, accessCheckEnabled ? new String[0] : new String[]{"dev"});
    }

    private ReportSummaryQueryService summaryQueryService(boolean accessCheckEnabled, String... activeProfiles) {
        ReportProperties properties = new ReportProperties();
        properties.setProjectAccessCheckEnabled(accessCheckEnabled);
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(activeProfiles);
        return new ReportSummaryQueryService(
                reportMapper,
                analysisFindingMapper,
                runService,
                new ReportAccessGuard(projectAccessService, properties, environment),
                new ReportJsonReader(new ObjectMapper()),
                new ReportPreviewImageResolver(artifactMapper)
        );
    }

    private Report report(UUID runId, UUID analysisJobId, UUID artifactId) {
        Report report = new Report();
        report.setId(UUID.randomUUID());
        report.setRunId(runId);
        report.setAnalysisJobId(analysisJobId);
        report.setTitle("Landing CTA audit");
        report.setFormat(ReportFormat.JSON);
        report.setStatus(ReportStatus.READY);
        report.setSummaryJsonb("{\"friction_score\":61.0,\"headline\":\"CTA issue\"}");
        report.setDecisionMapJsonb("""
                [{"stage":"CTA","displayName":"행동 선택","status":"WARNING",
                "issueIds":["issue_001"],"summary":"CTA가 경쟁합니다.","evidenceRefs":["cp_001.obs_001"]}]
                """);
        report.setArtifactId(artifactId);
        report.setCreatedAt(OffsetDateTime.parse("2026-04-29T12:00:00+09:00"));
        return report;
    }

    private AnalysisFinding finding(int rank, String stage, BigDecimal priorityScore) {
        AnalysisFinding finding = new AnalysisFinding();
        finding.setId(UUID.randomUUID());
        finding.setRankOrder(rank);
        finding.setTitle("CTA issue");
        finding.setSummary("CTA is unclear.");
        finding.setStage(stage);
        finding.setSeverity(2);
        finding.setConfidence(new BigDecimal("0.87"));
        finding.setPriorityScore(priorityScore);
        return finding;
    }

    private Artifact screenshot(UUID runId, String key) {
        Artifact artifact = new Artifact();
        artifact.setId(UUID.randomUUID());
        artifact.setRunId(runId);
        artifact.setArtifactType(ArtifactType.SCREENSHOT);
        artifact.setS3Bucket("wedge-artifacts");
        artifact.setS3Key(key);
        artifact.setMimeType("image/png");
        artifact.setWidth(1440);
        artifact.setHeight(900);
        artifact.setSizeBytes(1024);
        artifact.setCapturedAt(OffsetDateTime.parse("2026-04-29T12:00:00+09:00"));
        return artifact;
    }

    private com.wedge.run.api.dto.RunResponse runResponse(UUID runId, UUID projectId) {
        return new com.wedge.run.api.dto.RunResponse(
                runId,
                "run",
                projectId,
                "Landing CTA audit",
                "WEB",
                java.net.URI.create("https://example.com"),
                "CTA audit",
                "desktop",
                null,
                com.wedge.run.domain.RunStatus.COMPLETED,
                com.wedge.run.domain.ResultCompleteness.FINAL,
                com.wedge.run.domain.AnalysisStatus.COMPLETED,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
