package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.domain.Nudge;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.analysis.infrastructure.NudgeMapper;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
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
import org.springframework.mock.env.MockEnvironment;

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
    @Mock
    private CheckpointMapper checkpointMapper;

    private ReportDetailQueryService reportDetailQueryService;

    @BeforeEach
    void setUp() {
        ReportProperties properties = new ReportProperties();
        reportDetailQueryService = new ReportDetailQueryService(
                reportMapper,
                analysisFindingMapper,
                nudgeMapper,
                runService,
                new ReportAccessGuard(projectAccessService, properties, new MockEnvironment()),
                new ReportJsonReader(new ObjectMapper()),
                new ReportPreviewImageResolver(artifactMapper),
                checkpointMapper
        );
    }

    @Test
    void getReportDetailReturnsAllFindingsWithNudgesInPriorityOrder() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        UUID highlightArtifactId = UUID.randomUUID();
        Report report = report(runId, analysisJobId);
        AnalysisFinding firstFinding = finding(2, "INPUT", new BigDecimal("9.2"), highlightArtifactId);
        AnalysisFinding secondFinding = finding(1, "CTA", new BigDecimal("5.1"));
        AnalysisFinding legacyFinding = finding(3, null, new BigDecimal("1.0"));
        legacyFinding.setReferencesJsonb(null);
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
        when(artifactMapper.findLatestScreenshotByRunIdAndStage(runId, "CTA")).thenReturn(Optional.empty());
        when(artifactMapper.findByRunIdAndId(runId, highlightArtifactId))
                .thenReturn(Optional.of(screenshot(runId, highlightArtifactId, "highlight.png")));
        when(artifactMapper.findLatestScreenshotByRunId(runId)).thenReturn(Optional.of(screenshot(runId)));
        when(checkpointMapper.findByRunIdAndCheckpointKey(runId, "cp_001")).thenReturn(Optional.of(checkpoint("cp_001", 640)));

        ReportDetailResponse response = reportDetailQueryService.getReportDetail(report.getId(), userId);

        assertThat(response.initialDisplayCount()).isEqualTo(3);
        assertThat(response.findings()).hasSize(3);
        assertThat(response.findings().get(0).nudges())
                .extracting(ReportDetailNudgeResponse::title)
                .containsExactly("Reduce input friction", "Add inline help", "Rankless fallback");
        assertThat(response.findings().get(1).nudges()).singleElement()
                .satisfies(item -> assertThat(item.title()).isEqualTo("Make CTA clearer"));
        assertThat(response.findings().get(2).stage()).isNull();
        assertThat(response.findings().get(2).references()).isEmpty();
        assertThat(response.findings().get(0).evidenceRefs()).isInstanceOf(List.class);
        assertThat(response.findings().get(0).references()).singleElement()
                .satisfies(reference -> assertThat(reference).isInstanceOf(java.util.Map.class));
        assertThat(response.findings().get(0).highlight()).isNotNull();
        assertThat(response.findings().get(0).highlight().label()).isEqualTo("Start free");
        assertThat(response.findings().get(0).highlight().coordinateSpace()).isEqualTo("viewport");
        assertThat(response.findings().get(0).highlight().bounds().x()).isEqualByComparingTo(new BigDecimal("520.0"));
        assertThat(response.findings().get(0).highlight().scrollY()).isEqualByComparingTo(new BigDecimal("640"));
        assertThat(response.findings().get(0).previewImage().source()).isEqualTo("HIGHLIGHT_SCREENSHOT");
        assertThat(response.findings().get(0).previewImage().artifact().id()).isEqualTo(highlightArtifactId);
        assertThat(response.findings().get(0).highlight().screenshotArtifactId()).isEqualTo(highlightArtifactId.toString());
    }


    @Test
    void getReportDetailRejectsMissingOrDeletedReportBeforeRunLookup() {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportMapper.findById(reportId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportDetailQueryService.getReportDetail(reportId, userId))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.REPORT_NOT_FOUND)
                );

        verifyNoInteractions(runService, projectAccessService, analysisFindingMapper, nudgeMapper, artifactMapper, checkpointMapper);
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
        return finding(rank, stage, priorityScore, null);
    }

    private AnalysisFinding finding(int rank, String stage, BigDecimal priorityScore, UUID screenshotArtifactId) {
        AnalysisFinding finding = new AnalysisFinding();
        finding.setId(UUID.randomUUID());
        finding.setRankOrder(rank);
        finding.setTitle("CTA issue");
        finding.setSummary("CTA is unclear.");
        finding.setStage(stage);
        finding.setSeverity(2);
        finding.setConfidence(new BigDecimal("0.87"));
        finding.setPriorityScore(priorityScore);
        finding.setEvidenceRefsJsonb(screenshotArtifactId == null
                ? "[\"cp_001.obs_001\"]"
                : """
                    [{"ref":"cp_001.obs_001","problemComponent":{
                    "component_id":"component_001",
                    "evidence_ref":"cp_001.obs_001",
                    "label":"Start free",
                    "coordinate_space":"viewport",
                    "bounding_box":{"x":520,"y":360,"width":220,"height":56},
                    "viewport":{"width":1440,"height":900},
                    "screenshot_artifact_id":"artifact:%s"
                    }}]
                    """.formatted(screenshotArtifactId));
        finding.setReferencesJsonb("""
                [{"label":"WCAG 3.3.2","publisher":"W3C","title":"Labels or Instructions",
                "basisSummary":"Inputs need labels or instructions.","url":"https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html"}]
                """);
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
        return screenshot(runId, UUID.randomUUID(), "latest.png");
    }

    private Artifact screenshot(UUID runId, UUID artifactId, String key) {
        Artifact artifact = new Artifact();
        artifact.setId(artifactId);
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

    private Checkpoint checkpoint(String checkpointKey, int scrollY) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(UUID.randomUUID());
        checkpoint.setCheckpointKey(checkpointKey);
        checkpoint.setStateJsonb("{\"scrollY\":%d,\"viewport\":{\"width\":1440,\"height\":900}}".formatted(scrollY));
        return checkpoint;
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
