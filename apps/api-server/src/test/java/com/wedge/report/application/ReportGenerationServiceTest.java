package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.analysis.infrastructure.NudgeMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.report.api.dto.RunReportResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ReportStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.RunMapper;
import java.math.BigDecimal;
import java.net.URI;
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

@ExtendWith(MockitoExtension.class)
class ReportGenerationServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private RunService runService;

    @Mock
    private AnalysisJobMapper analysisJobMapper;

    @Mock
    private AnalysisFindingMapper analysisFindingMapper;

    @Mock
    private NudgeMapper nudgeMapper;

    @Mock
    private ReportMapper reportMapper;

    @Mock
    private RunMapper runMapper;

    @Captor
    private ArgumentCaptor<Report> reportCaptor;

    private ReportGenerationService reportGenerationService;

    @BeforeEach
    void setUp() {
        reportGenerationService = new ReportGenerationService(
                runService,
                analysisJobMapper,
                analysisFindingMapper,
                nudgeMapper,
                reportMapper,
                runMapper,
                objectMapper
        );
    }

    @Test
    void generateRunReportCreatesReportFromLatestCompletedAnalysis() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        AnalysisJob analysisJob = completedAnalysisJob(runId, analysisJobId);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(analysisJobMapper.findLatestCompletedByRunId(runId)).thenReturn(Optional.of(analysisJob));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of());
        when(analysisFindingMapper.findByAnalysisJobId(analysisJobId)).thenReturn(List.of());
        when(nudgeMapper.findByAnalysisJobId(analysisJobId)).thenReturn(List.of());

        RunReportResponse response = reportGenerationService.generateRunReport(runId);

        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.reportStatus()).isEqualTo("READY");
        assertThat(response.analysisStatus()).isEqualTo(AnalysisJobStatus.COMPLETED.name());
        assertThat(response.analysisJobId()).isEqualTo(analysisJobId);
        assertThat(response.summary().get("friction_score").asDouble()).isEqualTo(61.0);
        assertThat(response.decisionMap()).hasSize(1);

        verify(reportMapper).insert(reportCaptor.capture());
        Report report = reportCaptor.getValue();
        assertThat(report.getRunId()).isEqualTo(runId);
        assertThat(report.getAnalysisJobId()).isEqualTo(analysisJobId);
        assertThat(report.getFormat()).isEqualTo(ReportFormat.JSON);
        assertThat(report.getStatus()).isEqualTo(ReportStatus.READY);
        assertThat(report.getSummaryJsonb()).contains("friction_score");
        verify(runMapper).updateAnalysisState(runId, AnalysisStatus.COMPLETED, analysisJobId, new BigDecimal("61.0"), response.reportId());
    }

    @Test
    void getRunReportReturnsGeneratableWhenCompletedAnalysisExistsWithoutReport() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID analysisJobId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(reportMapper.findByRunId(runId)).thenReturn(List.of());
        when(analysisJobMapper.findLatestByRunId(runId)).thenReturn(Optional.of(completedAnalysisJob(runId, analysisJobId)));

        RunReportResponse response = reportGenerationService.getRunReport(runId);

        assertThat(response.reportStatus()).isEqualTo("GENERATABLE");
        assertThat(response.analysisStatus()).isEqualTo(AnalysisJobStatus.COMPLETED.name());
        assertThat(response.analysisJobId()).isEqualTo(analysisJobId);
        assertThat(response.reportId()).isNull();
    }

    @Test
    void generateRunReportRejectsMissingCompletedAnalysis() {
        UUID runId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(analysisJobMapper.findLatestCompletedByRunId(runId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportGenerationService.generateRunReport(runId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.STATE_CONFLICT);
    }

    private AnalysisJob completedAnalysisJob(UUID runId, UUID analysisJobId) throws Exception {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(analysisJobId);
        analysisJob.setRunId(runId);
        analysisJob.setStatus(AnalysisJobStatus.COMPLETED);
        analysisJob.setFrictionScore(new BigDecimal("61.0"));
        analysisJob.setOutputJsonb(objectMapper.writeValueAsString(Map.of(
                "judgeResult", Map.of(
                        "summary", Map.of("friction_score", 61.0, "top_issues_count", 1),
                        "decision_map", List.of(Map.of("stage", "CTA", "status", "WARNING"))
                )
        )));
        return analysisJob;
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
}
