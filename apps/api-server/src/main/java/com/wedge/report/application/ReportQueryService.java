package com.wedge.report.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.report.api.dto.ReportPreviewImageResponse;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.api.dto.ReportTopFindingResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReportQueryService {
    private static final int SUMMARY_TOP_FINDING_LIMIT = 3;
    private static final String STAGE_SCREENSHOT = "STAGE_SCREENSHOT";
    private static final String REPORT_ARTIFACT = "REPORT_ARTIFACT";
    private static final String LATEST_SCREENSHOT = "LATEST_SCREENSHOT";

    private final ReportMapper reportMapper;
    private final AnalysisFindingMapper analysisFindingMapper;
    private final ArtifactMapper artifactMapper;
    private final RunService runService;
    private final ProjectAccessService projectAccessService;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public List<ReportSummaryResponse> listRunReportSummaries(UUID runId, UUID userId) {
        RunResponse run = runService.getRun(runId);
        projectAccessService.ensureProjectAccessible(run.projectId(), userId);
        return reportMapper.findByRunId(runId).stream()
                .map(this::toSummaryResponse)
                .toList();
    }

    private ReportSummaryResponse toSummaryResponse(Report report) {
        List<ReportTopFindingResponse> topFindings = topFindings(report);
        Object summary = readJson(report.getSummaryJsonb(), Map.of());
        return new ReportSummaryResponse(
                report.getId(),
                report.getRunId(),
                report.getAnalysisJobId(),
                report.getTitle(),
                report.getFormat(),
                report.getStatus(),
                readFrictionScore(summary),
                summary,
                readJson(report.getDecisionMapJsonb(), List.of()),
                topFindings,
                report.getCreatedAt()
        );
    }

    private List<ReportTopFindingResponse> topFindings(Report report) {
        if (report.getAnalysisJobId() == null) {
            return List.of();
        }
        return analysisFindingMapper.findTopByAnalysisJobId(report.getAnalysisJobId(), SUMMARY_TOP_FINDING_LIMIT).stream()
                .map(finding -> toTopFindingResponse(report, finding))
                .toList();
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
                previewImage(report, finding)
        );
    }

    private ReportPreviewImageResponse previewImage(Report report, AnalysisFinding finding) {
        return stageScreenshot(report.getRunId(), finding.getStage())
                .or(() -> reportScreenshot(report))
                .or(() -> latestScreenshot(report.getRunId()))
                .orElse(null);
    }

    private Optional<ReportPreviewImageResponse> stageScreenshot(UUID runId, String stage) {
        if (stage == null || stage.isBlank()) {
            return Optional.empty();
        }
        return artifactMapper.findLatestScreenshotByRunIdAndStage(runId, stage)
                .map(artifact -> previewImage(artifact, STAGE_SCREENSHOT));
    }

    private Optional<ReportPreviewImageResponse> reportScreenshot(Report report) {
        if (report.getArtifactId() == null) {
            return Optional.empty();
        }
        return artifactMapper.findByRunIdAndId(report.getRunId(), report.getArtifactId())
                .filter(artifact -> artifact.getArtifactType() == ArtifactType.SCREENSHOT)
                .map(artifact -> previewImage(artifact, REPORT_ARTIFACT));
    }

    private Optional<ReportPreviewImageResponse> latestScreenshot(UUID runId) {
        return artifactMapper.findLatestScreenshotByRunId(runId)
                .map(artifact -> previewImage(artifact, LATEST_SCREENSHOT));
    }

    private ReportPreviewImageResponse previewImage(Artifact artifact, String source) {
        return new ReportPreviewImageResponse(ArtifactResponse.from(artifact), source);
    }

    private BigDecimal readFrictionScore(Object summary) {
        if (summary instanceof Map<?, ?> summaryMap) {
            Object value = summaryMap.get("friction_score");
            if (value instanceof Number number) {
                return BigDecimal.valueOf(number.doubleValue());
            }
        }
        return null;
    }

    private Object readJson(String json, Object defaultValue) {
        if (json == null || json.isBlank()) {
            return defaultValue;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (JsonProcessingException exception) {
            throw invalidStoredJson(exception);
        }
    }

    private BusinessException invalidStoredJson(JsonProcessingException exception) {
        return new BusinessException(ErrorCode.INTERNAL_ERROR, "Stored report JSON is invalid.", null, exception);
    }
}
