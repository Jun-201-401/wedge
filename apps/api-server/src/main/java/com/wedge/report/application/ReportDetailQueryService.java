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
import com.wedge.report.api.dto.ReportFindingHighlightResponse;
import com.wedge.report.api.dto.ReportPreviewImageResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.LinkedHashMap;
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
        Report report = findReport(reportId);
        RunResponse run = runService.getRun(report.getRunId());
        reportAccessGuard.ensureProjectAccessible(run.projectId(), userId);
        return toDetailResponse(report);
    }

    @Transactional(readOnly = true)
    public ReportDetailResponse getSharedReportDetail(UUID reportId) {
        return toDetailResponse(findReport(reportId));
    }

    private Report findReport(UUID reportId) {
        return reportMapper.findById(reportId)
                .orElseThrow(() -> new BusinessException(ErrorCode.REPORT_NOT_FOUND));
    }

    private ReportDetailResponse toDetailResponse(Report report) {
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
        List<Object> evidenceRefs = reportJsonReader.readArray(finding.getEvidenceRefsJsonb());
        List<Object> references = reportJsonReader.readArray(finding.getReferencesJsonb());
        ReportFindingHighlightResponse highlight = highlight(evidenceRefs);
        ReportPreviewImageResponse previewImage = previewImageResolver.resolve(
                report,
                finding,
                previewContext,
                highlight == null ? null : highlight.screenshotArtifactId()
        );
        if (!matchesPreviewArtifact(highlight, previewImage)) {
            highlight = null;
        }
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
                evidenceRefs,
                references,
                previewImage,
                highlight,
                detailNudges(nudgesByFindingId.getOrDefault(finding.getId(), List.of()))
        );
    }

    private boolean matchesPreviewArtifact(
            ReportFindingHighlightResponse highlight,
            ReportPreviewImageResponse previewImage
    ) {
        return highlight != null
                && previewImage != null
                && previewImage.artifact() != null
                && previewImage.artifact().id().toString().equals(highlight.screenshotArtifactId());
    }

    private ReportFindingHighlightResponse highlight(List<Object> evidenceRefs) {
        for (Object ref : evidenceRefs) {
            Map<String, Object> component = problemComponent(ref);
            if (component == null) {
                continue;
            }

            ReportFindingHighlightResponse.Bounds bounds = bounds(component);
            String screenshotArtifactId = normalizeArtifactRef(readString(component, "screenshot_artifact_id", null));
            if (bounds == null || screenshotArtifactId == null) {
                continue;
            }

            return new ReportFindingHighlightResponse(
                    readString(component, "evidence_ref", null),
                    highlightLabel(component),
                    "artifact-coordinate",
                    readString(component, "coordinate_space", "viewport"),
                    bounds,
                    viewport(component),
                    screenshotArtifactId
            );
        }

        return null;
    }

    private Map<String, Object> problemComponent(Object ref) {
        Map<String, Object> refMap = asMap(ref);
        if (refMap == null) {
            return null;
        }

        Map<String, Object> problemComponent = readMap(refMap, "problemComponent");
        if (!problemComponent.isEmpty()) {
            return problemComponent;
        }

        problemComponent = readMap(refMap, "problem_component");
        if (!problemComponent.isEmpty()) {
            return problemComponent;
        }

        Map<String, Object> location = readMap(refMap, "evidenceLocation");
        return firstMap(readList(location, "problem_components"));
    }

    private String highlightLabel(Map<String, Object> target) {
        Object label = target.get("label");
        if (label instanceof String value && !value.isBlank()) {
            return value;
        }

        Object text = target.get("text");
        if (text instanceof String value && !value.isBlank()) {
            return value;
        }

        Object selector = target.get("selector");
        if (selector instanceof String value && !value.isBlank()) {
            return value;
        }

        return "EVIDENCE TARGET";
    }

    private String readString(Map<String, Object> source, String key, String defaultValue) {
        Object value = source.get(key);
        return value instanceof String text && !text.isBlank() ? text : defaultValue;
    }

    private String normalizeArtifactRef(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.startsWith("artifact:") ? value.substring("artifact:".length()) : value;
    }

    private ReportFindingHighlightResponse.Bounds bounds(Map<String, Object> source) {
        Map<String, Object> rawBounds = readMap(source, "bounding_box");
        if (rawBounds.isEmpty()) {
            rawBounds = readMap(source, "bounds");
        }

        BigDecimal x = readDecimal(rawBounds, "x");
        BigDecimal y = readDecimal(rawBounds, "y");
        BigDecimal width = readDecimal(rawBounds, "width");
        BigDecimal height = readDecimal(rawBounds, "height");
        if (x == null || y == null || width == null || height == null) {
            return null;
        }

        return new ReportFindingHighlightResponse.Bounds(
                x,
                y,
                width,
                height,
                readString(rawBounds, "unit", "css_px")
        );
    }

    private ReportFindingHighlightResponse.Viewport viewport(Map<String, Object> source) {
        Map<String, Object> rawViewport = readMap(source, "viewport");
        BigDecimal width = readDecimal(rawViewport, "width");
        BigDecimal height = readDecimal(rawViewport, "height");
        if (width == null || height == null) {
            return null;
        }
        return new ReportFindingHighlightResponse.Viewport(width, height);
    }

    private BigDecimal readDecimal(Map<String, Object> source, String key) {
        Object value = source.get(key);
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue());
        }
        return null;
    }

    private Map<String, Object> readMap(Map<String, Object> source, String key) {
        Object value = source.get(key);
        Map<String, Object> result = asMap(value);
        return result == null ? Map.of() : result;
    }

    private List<Object> readList(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value instanceof List<?> list ? List.copyOf(list) : List.of();
    }

    private Map<String, Object> firstMap(List<Object> values) {
        return values.stream()
                .map(this::asMap)
                .filter(map -> map != null && !map.isEmpty())
                .findFirst()
                .orElse(null);
    }

    private Map<String, Object> asMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return null;
        }

        Map<String, Object> result = new LinkedHashMap<>();
        map.forEach((key, mapValue) -> result.put(String.valueOf(key), mapValue));
        return result;
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
