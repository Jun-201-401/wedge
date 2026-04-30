package com.wedge.report.application;

import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.api.dto.ReportTopFindingResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReportSummaryQueryService {
    private static final int SUMMARY_TOP_FINDING_LIMIT = 3;
    private static final Set<String> VALID_STAGES = Set.of("FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT");

    private final ReportMapper reportMapper;
    private final AnalysisFindingMapper analysisFindingMapper;
    private final RunService runService;
    private final ReportAccessGuard reportAccessGuard;
    private final ReportJsonReader reportJsonReader;
    private final ReportPreviewImageResolver previewImageResolver;

    @Transactional(readOnly = true)
    public List<ReportSummaryResponse> listRunReportSummaries(UUID runId, UUID userId) {
        RunResponse run = runService.getRun(runId);
        reportAccessGuard.ensureProjectAccessible(run.projectId(), userId);
        return reportMapper.findByRunId(runId).stream()
                .map(this::toSummaryResponse)
                .toList();
    }

    private ReportSummaryResponse toSummaryResponse(Report report) {
        Map<String, Object> summary = reportJsonReader.readObject(report.getSummaryJsonb());
        return new ReportSummaryResponse(
                report.getId(),
                report.getRunId(),
                report.getAnalysisJobId(),
                report.getTitle(),
                report.getFormat(),
                report.getStatus(),
                reportJsonReader.readFrictionScore(summary),
                summary,
                reportJsonReader.readDecisionMap(report.getDecisionMapJsonb()),
                topFindings(report),
                report.getCreatedAt()
        );
    }

    private List<ReportTopFindingResponse> topFindings(Report report) {
        if (report.getAnalysisJobId() == null) {
            return List.of();
        }
        return analysisFindingMapper.findTopByAnalysisJobId(report.getAnalysisJobId(), SUMMARY_TOP_FINDING_LIMIT).stream()
                .filter(this::hasStage)
                .map(finding -> toTopFindingResponse(report, finding))
                .toList();
    }

    private boolean hasStage(AnalysisFinding finding) {
        return finding.getStage() != null && VALID_STAGES.contains(finding.getStage());
    }

    private ReportTopFindingResponse toTopFindingResponse(Report report, AnalysisFinding finding) {
        return new ReportTopFindingResponse(
                finding.getId(),
                finding.getRankOrder(),
                finding.getTitle(),
                finding.getSummary(),
                finding.getStage(),
                finding.getSeverity(),
                finding.getConfidence(),
                finding.getPriorityScore(),
                previewImageResolver.resolve(report, finding)
        );
    }
}
