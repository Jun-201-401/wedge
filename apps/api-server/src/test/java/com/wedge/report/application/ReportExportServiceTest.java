package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactContentWriter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.report.api.dto.DecisionMapItemResponse;
import com.wedge.report.api.dto.ReportCreateRequest;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportExportResponse;
import com.wedge.report.api.dto.ReportFindingHighlightResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ReportStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
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
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

@ExtendWith(MockitoExtension.class)
class ReportExportServiceTest {
    private static final Instant FIXED_INSTANT = Instant.parse("2026-05-11T01:00:00Z");

    @Mock
    private RunService runService;

    @Mock
    private ReportAccessGuard reportAccessGuard;

    @Mock
    private ReportMapper reportMapper;

    @Mock
    private ArtifactMapper artifactMapper;

    @Mock
    private ArtifactPersistenceService artifactPersistenceService;

    @Mock
    private ArtifactContentWriter artifactContentWriter;

    @Mock
    private ReportDetailQueryService reportDetailQueryService;

    @Captor
    private ArgumentCaptor<SaveRunArtifactsCommand> artifactsCommandCaptor;

    @Captor
    private ArgumentCaptor<Artifact> artifactCaptor;

    @Captor
    private ArgumentCaptor<byte[]> contentCaptor;

    private ReportExportService reportExportService;

    @BeforeEach
    void setUp() {
        reportExportService = new ReportExportService(
                runService,
                reportAccessGuard,
                reportMapper,
                artifactMapper,
                artifactPersistenceService,
                artifactContentWriter,
                reportDetailQueryService,
                new ReportMarkdownRenderer(new ReportDownloadDocumentBuilder()),
                new TestReportPdfRenderer(),
                Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC),
                transactionTemplate()
        );
    }

    @Test
    void createRunReportExportRendersMarkdownArtifactWithUtf8KoreanText() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        RunResponse run = sampleRun(runId);
        Report report = report(runId, reportId, analysisJobId, null);
        ReportDetailResponse detail = detail(report);
        when(runService.getRun(runId)).thenReturn(run);
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(reportDetailQueryService.getReportDetail(reportId, userId)).thenReturn(detail);

        ReportExportResponse response = reportExportService.createRunReportExport(
                runId,
                userId,
                new ReportCreateRequest(ReportFormat.MARKDOWN, analysisJobId)
        );

        verify(reportAccessGuard).ensureProjectAccessible(run.projectId(), userId);
        verify(artifactContentWriter).save(artifactCaptor.capture(), contentCaptor.capture());
        verify(artifactPersistenceService).saveRunArtifacts(org.mockito.Mockito.eq(runId), artifactsCommandCaptor.capture());
        UUID expectedArtifactId = UUID.nameUUIDFromBytes(
                ("report-export:screen-v9:" + reportId + ":MARKDOWN").getBytes(StandardCharsets.UTF_8)
        );
        Artifact artifact = artifactCaptor.getValue();
        assertThat(response.artifactId()).isEqualTo(expectedArtifactId);
        assertThat(artifact.getId()).isEqualTo(expectedArtifactId);
        assertThat(artifact.getArtifactType()).isEqualTo(ArtifactType.REPORT_MARKDOWN);
        assertThat(artifact.getS3Bucket()).isEqualTo("local-runner");
        assertThat(artifact.getMimeType()).isEqualTo("text/markdown; charset=utf-8");
        assertThat(artifact.getS3Key()).isEqualTo(runId + "/reports/" + reportId + "-" + expectedArtifactId + ".md");
        String markdown = new String(contentCaptor.getValue(), StandardCharsets.UTF_8);
        assertThat(markdown).contains("# 전환 흐름 리포트", "첫 화면 CTA 흐름 점검", "Nudge 01. CTA 카피 수정", "버튼 문구를 구체화하세요");
        assertThat(artifactsCommandCaptor.getValue().artifacts()).singleElement().satisfies(command -> {
            assertThat(command.artifactType()).isEqualTo(ArtifactType.REPORT_MARKDOWN);
            assertThat(command.sizeBytes()).isEqualTo(contentCaptor.getValue().length);
            assertThat(command.sha256()).hasSize(64);
        });
        assertThat(response.reportId()).isEqualTo(reportId);
        assertThat(response.format()).isEqualTo(ReportFormat.MARKDOWN);
        assertThat(response.status()).isEqualTo(ReportStatus.READY);
        assertThat(response.downloadUrl()).isEqualTo("/api/runs/" + runId + "/artifacts/" + response.artifactId() + "/content");
    }

    @Test
    void createRunReportExportReusesExistingMarkdownArtifact() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        UUID artifactId = UUID.nameUUIDFromBytes(
                ("report-export:screen-v9:" + reportId + ":MARKDOWN").getBytes(StandardCharsets.UTF_8)
        );
        RunResponse run = sampleRun(runId);
        Report report = report(runId, reportId, analysisJobId, artifactId);
        Artifact artifact = new Artifact();
        artifact.setId(artifactId);
        artifact.setRunId(runId);
        artifact.setArtifactType(ArtifactType.REPORT_MARKDOWN);
        artifact.setS3Key(runId + "/reports/" + reportId + ".md");
        artifact.setMimeType("text/markdown; charset=utf-8");
        artifact.setCreatedAt(OffsetDateTime.now(Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC)));
        when(runService.getRun(runId)).thenReturn(run);
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(artifactMapper.findByRunIdAndId(runId, artifactId)).thenReturn(Optional.of(artifact));

        ReportExportResponse response = reportExportService.createRunReportExport(
                runId,
                userId,
                new ReportCreateRequest(ReportFormat.MARKDOWN, null)
        );

        assertThat(response.artifactId()).isEqualTo(artifactId);
        verify(artifactContentWriter, never()).save(any(), any());
        verify(artifactPersistenceService, never()).saveRunArtifacts(any(), any());
    }

    @Test
    void createRunReportExportRendersPdfArtifact() {
        UUID runId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID reportId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        RunResponse run = sampleRun(runId);
        Report report = report(runId, reportId, analysisJobId, null);
        ReportDetailResponse detail = detailWithHighlight(report, UUID.randomUUID());
        when(runService.getRun(runId)).thenReturn(run);
        when(reportMapper.findByRunId(runId)).thenReturn(List.of(report));
        when(reportDetailQueryService.getReportDetail(reportId, userId)).thenReturn(detail);

        ReportExportResponse response = reportExportService.createRunReportExport(
                runId,
                userId,
                new ReportCreateRequest(ReportFormat.PDF, analysisJobId)
        );

        verify(artifactContentWriter).save(artifactCaptor.capture(), contentCaptor.capture());
        UUID expectedArtifactId = UUID.nameUUIDFromBytes(
                ("report-export:screen-v9:" + reportId + ":PDF").getBytes(StandardCharsets.UTF_8)
        );
        Artifact artifact = artifactCaptor.getValue();
        byte[] content = contentCaptor.getValue();
        assertThat(response.artifactId()).isEqualTo(expectedArtifactId);
        assertThat(response.format()).isEqualTo(ReportFormat.PDF);
        assertThat(artifact.getArtifactType()).isEqualTo(ArtifactType.REPORT_PDF);
        assertThat(artifact.getMimeType()).isEqualTo("application/pdf");
        assertThat(artifact.getS3Key()).isEqualTo(runId + "/reports/" + reportId + "-" + expectedArtifactId + ".pdf");
        assertThat(new String(content, 0, Math.min(content.length, 5), StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
    }

    @Test
    void createRunReportExportRejectsUnsupportedFormat() {
        assertThatThrownBy(() -> reportExportService.createRunReportExport(
                UUID.randomUUID(),
                UUID.randomUUID(),
                new ReportCreateRequest(ReportFormat.JSON, null)
        ))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.INVALID_REQUEST);
    }

    private RunResponse sampleRun(UUID runId) {
        return new RunResponse(
                runId,
                "run",
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "첫 화면 CTA 흐름 점검",
                "desktop",
                UUID.randomUUID(),
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

    private Report report(UUID runId, UUID reportId, UUID analysisJobId, UUID artifactId) {
        Report report = new Report();
        report.setId(reportId);
        report.setRunId(runId);
        report.setAnalysisJobId(analysisJobId);
        report.setTitle("JudgeResult analysis report");
        report.setFormat(ReportFormat.JSON);
        report.setStatus(ReportStatus.READY);
        report.setSummaryJsonb("{}");
        report.setDecisionMapJsonb("[]");
        report.setArtifactId(artifactId);
        return report;
    }

    private ReportDetailResponse detail(Report report) {
        return detail(report, null);
    }

    private ReportDetailResponse detailWithHighlight(Report report, UUID screenshotArtifactId) {
        return detail(report, screenshotArtifactId);
    }

    private ReportDetailResponse detail(Report report, UUID screenshotArtifactId) {
        ReportDetailNudgeResponse nudge = new ReportDetailNudgeResponse(
                UUID.randomUUID(),
                1,
                "CTA 카피 수정",
                "사용자가 다음 행동의 가치를 바로 판단하기 어렵습니다.",
                "버튼 문구를 구체화하세요",
                "낮음",
                "클릭 전환율 개선",
                "사용자가 첫 화면에서 다음 행동을 설명할 수 있나요?"
        );
        ReportFindingHighlightResponse highlight = screenshotArtifactId == null ? null : new ReportFindingHighlightResponse(
                "checkpoint-1.component_001",
                "Start free",
                "artifact-coordinate",
                "viewport",
                new ReportFindingHighlightResponse.Bounds(
                        BigDecimal.valueOf(180),
                        BigDecimal.valueOf(150),
                        BigDecimal.valueOf(120),
                        BigDecimal.valueOf(48),
                        "css_px"
                ),
                new ReportFindingHighlightResponse.Viewport(BigDecimal.valueOf(640), BigDecimal.valueOf(480)),
                BigDecimal.ZERO,
                screenshotArtifactId.toString()
        );
        ReportDetailFindingResponse finding = new ReportDetailFindingResponse(
                UUID.randomUUID(),
                1,
                "CTA 문구가 모호합니다",
                "첫 화면에서 핵심 CTA가 충분히 구체적이지 않습니다.",
                "copy",
                "첫 화면",
                "clarity",
                4,
                BigDecimal.valueOf(0.91),
                BigDecimal.valueOf(0.82),
                "사용자가 CTA 클릭 전에 기대 결과를 이해하지 못할 수 있습니다.",
                List.of(),
                List.of(),
                null,
                highlight,
                List.of(nudge)
        );
        return new ReportDetailResponse(
                report.getId(),
                report.getRunId(),
                report.getAnalysisJobId(),
                "전환 마찰 리포트",
                report.getFormat(),
                report.getStatus(),
                BigDecimal.valueOf(72),
                Map.of("핵심 요약", "CTA 명확성 개선 필요"),
                List.of(new DecisionMapItemResponse("첫 화면", "CTA 발견", "FRICTION", List.of("F-1"), "사용자가 버튼 가치를 판단해야 합니다.", List.of("artifact:1"))),
                3,
                List.of(finding),
                OffsetDateTime.now(Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC))
        );
    }

    private static final class TestReportPdfRenderer implements ReportPdfRenderer {
        @Override
        public byte[] render(ReportDetailResponse report, RunResponse run) {
            return "%PDF-FAKE\n".getBytes(StandardCharsets.US_ASCII);
        }
    }

    private TransactionTemplate transactionTemplate() {
        return new TransactionTemplate(new AbstractPlatformTransactionManager() {
            @Override
            protected Object doGetTransaction() {
                return new Object();
            }

            @Override
            protected void doBegin(Object transaction, TransactionDefinition definition) {
            }

            @Override
            protected void doCommit(DefaultTransactionStatus status) {
            }

            @Override
            protected void doRollback(DefaultTransactionStatus status) {
            }
        });
    }
}
