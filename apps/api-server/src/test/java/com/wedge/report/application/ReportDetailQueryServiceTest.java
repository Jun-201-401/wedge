package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.domain.Nudge;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.analysis.infrastructure.NudgeMapper;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
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
class ReportDetailQueryServiceTest {
    @Mock
    private ReportMapper reportMapper;
    @Mock
    private AnalysisFindingMapper analysisFindingMapper;
    @Mock
    private NudgeMapper nudgeMapper;
    @Mock
    private ArtifactMapper artifactMapper;
    @Mock
    private RunService runService;
    @Mock
    private ProjectAccessService projectAccessService;

    private ReportDetailQueryService reportDetailQueryService;

    @BeforeEach
    void setUp() {
        ReportProperties properties = new ReportProperties();
        reportDetailQueryService = new ReportDetailQueryService(
                reportMapper,
                analysisFindingMapper,
                nudgeMapper,
                runService,
                new ReportAccessGuard(projectAccessService, properties),
                new ReportJsonReader(new ObjectMapper()),
                new ReportPreviewImageResolver(artifactMapper)
        );
    }

    @Test
    void getReportDetailReturnsAllFindingsWithNudgesInPriorityOrder() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        Report report = report(runId, analysisJobId);
        AnalysisFinding firstFinding = finding(2, "INPUT", new BigDecimal("9.2"));
        AnalysisFinding secondFinding = finding(1, "CTA", new BigDecimal("5.1"));
        AnalysisFinding legacyFinding = finding(3, null, new BigDecimal("1.0"));
        when(reportMapper.findById(report.getId())).thenReturn(Optional.of(report));
        when(runService.getRun(runId)).thenReturn(runResponse(runId, UUID.randomUUID()));
        when(analysisFindingMapper.findByAnalysisJobIdOrderByPriority(analysisJobId))
                .thenReturn(List.of(firstFinding, secondFinding, legacyFinding));
        when(nudgeMapper.findByAnalysisJobId(analysisJobId)).thenReturn(List.of(
                nudge(analysisJobId, firstFinding.getId(), 2, "Add inline help"),
                nudge(analysisJobId, null, 1, "Ignore unbound nudge"),
                nudge(analysisJobId, secondFinding.getId(), 1, "Make CTA clearer"),
                nudge(analysisJobId, firstFinding.getId(), null, "Rankless fallback"),
                nudge(analysisJobId, firstFinding.getId(), 1, "Reduce input friction")
        ));
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "INPUT")).thenReturn(Optional.empty());
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "CTA")).thenReturn(Optional.empty());
        when(artifactMapper.findLatestScreenshotByRunId(runId)).thenReturn(Optional.of(screenshot(runId)));

        ReportDetailResponse response = reportDetailQueryService.getReportDetail(report.getId(), userId);

        assertThat(response.initialDisplayCount()).isEqualTo(3);
        assertThat(response.findings()).hasSize(3);
        assertThat(response.findings().get(0).nudges())
                .extracting(ReportDetailNudgeResponse::title)
                .containsExactly("Reduce input friction", "Add inline help", "Rankless fallback");
        assertThat(response.findings().get(1).nudges()).singleElement()
                .satisfies(item -> assertThat(item.title()).isEqualTo("Make CTA clearer"));
        assertThat(response.findings().get(2).stage()).isNull();
        assertThat(response.findings().get(0).previewImage().source()).isEqualTo("LATEST_SCREENSHOT");
        assertThat(response.findings().get(0).evidenceRefs()).isInstanceOf(List.class);
    }

    private Report report(UUID runId, UUID analysisJobId) {
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
        finding.setEvidenceRefsJsonb("[{\"ref\":\"cp_001.obs_001\"}]");
        return finding;
    }

    private Nudge nudge(UUID analysisJobId, UUID findingId, Integer rank, String title) {
        Nudge nudge = new Nudge();
        nudge.setId(UUID.randomUUID());
        nudge.setAnalysisJobId(analysisJobId);
        nudge.setFindingId(findingId);
        nudge.setRankOrder(rank);
        nudge.setTitle(title);
        return nudge;
    }

    private Artifact screenshot(UUID runId) {
        Artifact artifact = new Artifact();
        artifact.setId(UUID.randomUUID());
        artifact.setRunId(runId);
        artifact.setArtifactType(ArtifactType.SCREENSHOT);
        artifact.setS3Bucket("wedge-artifacts");
        artifact.setS3Key("latest.png");
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
