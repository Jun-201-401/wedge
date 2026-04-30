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

@ExtendWith(MockitoExtension.class)
class ReportQueryServiceTest {
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

    private ReportQueryService reportQueryService;

    @BeforeEach
    void setUp() {
        reportQueryService = new ReportQueryService(
                reportMapper,
                analysisFindingMapper,
                artifactMapper,
                runService,
                projectAccessService,
                new ObjectMapper(),
                true
        );
    }

    @Test
    void listRunReportSummariesIncludesTopThreeFindingsAndStagePreview() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        Report report = report(runId, analysisJobId, null);
        AnalysisFinding finding = finding(1, "CTA", new BigDecimal("9.2"));
        Artifact stageScreenshot = screenshot(runId, "stage/cta.png");
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(analysisFindingMapper.findTopByAnalysisJobId(analysisJobId, 3)).thenReturn(List.of(finding));
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "CTA")).thenReturn(Optional.of(stageScreenshot));

        List<ReportSummaryResponse> responses = reportQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses).hasSize(1);
        ReportSummaryResponse response = responses.get(0);
        assertThat(response.frictionScore()).isEqualByComparingTo(new BigDecimal("61.0"));
        assertThat(response.topFindings()).hasSize(1);
        assertThat(response.topFindings().get(0).previewImage().source()).isEqualTo("STAGE_SCREENSHOT");
        assertThat(response.topFindings().get(0).previewImage().artifact().key()).isEqualTo("stage/cta.png");
    }

    @Test
    void previewImageFallsBackToReportArtifactThenLatestScreenshot() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportArtifactId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        Report report = report(runId, analysisJobId, reportArtifactId);
        AnalysisFinding finding = finding(1, "CTA", new BigDecimal("3.0"));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(analysisFindingMapper.findTopByAnalysisJobId(analysisJobId, 3)).thenReturn(List.of(finding));
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "CTA")).thenReturn(Optional.empty());
        when(artifactMapper.findByRunIdAndId(runId, reportArtifactId))
                .thenReturn(Optional.of(screenshot(runId, "report.png")));

        List<ReportSummaryResponse> responses = reportQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses.get(0).topFindings().get(0).previewImage().source()).isEqualTo("REPORT_ARTIFACT");
    }

    @Test
    void previewImageFallsBackToLatestScreenshotWhenReportArtifactIsNotScreenshot() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportArtifactId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        Report report = report(runId, analysisJobId, reportArtifactId);
        AnalysisFinding finding = finding(1, "INPUT", new BigDecimal("2.0"));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(analysisFindingMapper.findTopByAnalysisJobId(analysisJobId, 3)).thenReturn(List.of(finding));
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "INPUT")).thenReturn(Optional.empty());
        when(artifactMapper.findByRunIdAndId(runId, reportArtifactId))
                .thenReturn(Optional.of(artifact(runId, "report.json", ArtifactType.REPORT_JSON)));
        when(artifactMapper.findLatestScreenshotByRunId(runId)).thenReturn(Optional.of(screenshot(runId, "latest.png")));

        List<ReportSummaryResponse> responses = reportQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses.get(0).topFindings().get(0).previewImage().source()).isEqualTo("LATEST_SCREENSHOT");
    }

    @Test
    void listRunReportSummariesCanSkipProjectAccessForMvpMode() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        reportQueryService = new ReportQueryService(
                reportMapper,
                analysisFindingMapper,
                artifactMapper,
                runService,
                projectAccessService,
                new ObjectMapper(),
                false
        );
        when(runService.getRun(runId)).thenReturn(runResponse(runId, projectId));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of());

        List<ReportSummaryResponse> responses = reportQueryService.listRunReportSummaries(runId, userId);

        assertThat(responses).isEmpty();
        verify(projectAccessService, never()).ensureProjectAccessible(projectId, userId);
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
        report.setDecisionMapJsonb("[{\"stage\":\"CTA\",\"status\":\"WARNING\"}]");
        report.setArtifactId(artifactId);
        report.setCreatedAt(OffsetDateTime.parse("2026-04-29T12:00:00+09:00"));
        return report;
    }

    private AnalysisFinding finding(int rank, String stage, BigDecimal priorityScore) {
        AnalysisFinding finding = new AnalysisFinding();
        finding.setId(UUID.randomUUID());
        finding.setRankOrder(rank);
        finding.setTitle("CTA 경쟁");
        finding.setSummary("CTA가 여러 개 경쟁합니다.");
        finding.setStage(stage);
        finding.setSeverity(2);
        finding.setConfidence(new BigDecimal("0.87"));
        finding.setPriorityScore(priorityScore);
        finding.setEvidenceRefsJsonb("[{\"ref\":\"cp_001.obs_001\"}]");
        return finding;
    }

    private Artifact screenshot(UUID runId, String key) {
        return artifact(runId, key, ArtifactType.SCREENSHOT);
    }

    private Artifact artifact(UUID runId, String key, ArtifactType artifactType) {
        Artifact artifact = new Artifact();
        artifact.setId(UUID.randomUUID());
        artifact.setRunId(runId);
        artifact.setArtifactType(artifactType);
        artifact.setS3Bucket("wedge-artifacts");
        artifact.setS3Key(key);
        artifact.setMimeType(artifactType == ArtifactType.SCREENSHOT ? "image/png" : "application/json");
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
