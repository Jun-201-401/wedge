package com.wedge.report.application;

import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.domain.Nudge;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.analysis.infrastructure.NudgeMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReportDetailQueryService {
    private static final int DETAIL_INITIAL_DISPLAY_COUNT = 3;

    private final ReportMapper reportMapper;
    private final AnalysisFindingMapper analysisFindingMapper;
    private final NudgeMapper nudgeMapper;
    private final RunService runService;
    private final ReportAccessGuard reportAccessGuard;
    private final ReportJsonReader reportJsonReader;
    private final ReportPreviewImageResolver previewImageResolver;

    @Transactional(readOnly = true)
    public ReportDetailResponse getReportDetail(UUID reportId, UUID userId) {
        Report report = reportMapper.findById(reportId)
                .orElseThrow(() -> new BusinessException(ErrorCode.REPORT_NOT_FOUND));
        RunResponse run = runService.getRun(report.getRunId());
        reportAccessGuard.ensureProjectAccessible(run.projectId(), userId);

        Map<String, Object> summary = reportJsonReader.readObject(report.getSummaryJsonb());
        return new ReportDetailResponse(
                report.getId(),
                report.getRunId(),
                report.getAnalysisJobId(),
                report.getTitle(),
                report.getFormat(),
                report.getStatus(),
                reportJsonReader.readFrictionScore(summary),
                summary,
                reportJsonReader.readDecisionMap(report.getDecisionMapJsonb()),
                DETAIL_INITIAL_DISPLAY_COUNT,
                detailFindings(report),
                report.getCreatedAt()
        );
    }

    private List<ReportDetailFindingResponse> detailFindings(Report report) {
        if (report.getAnalysisJobId() == null) {
            return List.of();
        }
        List<AnalysisFinding> findings = analysisFindingMapper.findByAnalysisJobIdOrderByPriority(report.getAnalysisJobId());
        if (findings.isEmpty()) {
            return List.of();
        }
        return toDetailFindingResponses(report, findings);
    }

    private List<ReportDetailFindingResponse> toDetailFindingResponses(
            Report report,
            List<AnalysisFinding> findings
    ) {
        Map<UUID, List<Nudge>> nudgesByFindingId = nudgesByFindingId(report.getAnalysisJobId());
        ReportPreviewImageResolver.DetailPreviewContext previewContext = previewImageResolver.detailContext(report);
        return findings.stream()
                .map(finding -> toDetailFindingResponse(report, finding, nudgesByFindingId, previewContext))
                .toList();
    }

    private Map<UUID, List<Nudge>> nudgesByFindingId(UUID analysisJobId) {
        Map<UUID, List<Nudge>> grouped = nudgeMapper.findByAnalysisJobId(analysisJobId).stream()
                .filter(nudge -> nudge.getFindingId() != null)
                .collect(Collectors.groupingBy(Nudge::getFindingId));
        grouped.values().forEach(this::sortNudges);
        return grouped;
    }

    private void sortNudges(List<Nudge> nudges) {
        nudges.sort(Comparator.comparing(Nudge::getRankOrder, Comparator.nullsLast(Integer::compareTo)));
    }

    private ReportDetailFindingResponse toDetailFindingResponse(
            Report report,
            AnalysisFinding finding,
            Map<UUID, List<Nudge>> nudgesByFindingId,
            ReportPreviewImageResolver.DetailPreviewContext previewContext
    ) {
        return new ReportDetailFindingResponse(
                finding.getId(),
                finding.getRankOrder(),
                finding.getTitle(),
                finding.getSummary(),
                finding.getCategory(),
                finding.getStage(),
                finding.getAxis(),
                finding.getSeverity(),
                finding.getConfidence(),
                finding.getPriorityScore(),
                finding.getImpactHypothesis(),
                reportJsonReader.readArray(finding.getEvidenceRefsJsonb()),
                previewImageResolver.resolve(report, finding, previewContext),
                detailNudges(nudgesByFindingId.getOrDefault(finding.getId(), List.of()))
        );
    }

    private List<ReportDetailNudgeResponse> detailNudges(List<Nudge> nudges) {
        return nudges.stream()
                .map(this::toDetailNudgeResponse)
                .toList();
    }

    private ReportDetailNudgeResponse toDetailNudgeResponse(Nudge nudge) {
        return new ReportDetailNudgeResponse(
                nudge.getId(),
                nudge.getRankOrder(),
                nudge.getTitle(),
                nudge.getRationale(),
                nudge.getRecommendation(),
                nudge.getDifficulty(),
                nudge.getExpectedEffect(),
                nudge.getValidationQuestion()
        );
    }
}
