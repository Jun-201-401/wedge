package com.wedge.report.application;

import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportFindingHighlightResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.run.api.dto.RunResponse;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Component;

@Component
class ReportDownloadDocumentBuilder {
    private static final String DEFAULT_IMPROVEMENT_DIRECTION = "분석 결과에 맞춰 전환 마찰을 줄이는 개선안을 검토하세요.";

    ReportDownloadDocument build(ReportDetailResponse report, RunResponse run) {
        List<ReportDetailFindingResponse> findings = safeList(report.findings());
        List<ReportDownloadCandidate> candidates = buildCandidates(findings);
        int totalSteps = Math.max(Math.max(safeList(report.decisionMap()).size(), run.currentStepOrder() == null ? 0 : run.currentStepOrder()), 1);

        return new ReportDownloadDocument(
                report.id(),
                report.runId(),
                run.startUrl() == null ? "-" : run.startUrl().toString(),
                textOrDash(run.goal()),
                report.createdAt() == null ? "-" : DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(report.createdAt()),
                totalSteps,
                findings.size(),
                durationLabel(run),
                candidates,
                flowGuides()
        );
    }

    private List<ReportDownloadCandidate> buildCandidates(List<ReportDetailFindingResponse> findings) {
        List<CandidateSource> sources = new ArrayList<>();
        for (int findingIndex = 0; findingIndex < findings.size(); findingIndex++) {
            ReportDetailFindingResponse finding = findings.get(findingIndex);
            List<ReportDetailNudgeResponse> nudges = safeList(finding.nudges());
            for (int nudgeIndex = 0; nudgeIndex < nudges.size(); nudgeIndex++) {
                sources.add(new CandidateSource(finding, nudges.get(nudgeIndex), findingIndex, nudgeIndex));
            }
        }

        sources.sort(Comparator
                .comparingInt((CandidateSource source) -> source.finding().rank())
                .thenComparingInt(source -> source.nudge().rank() == null ? Integer.MAX_VALUE : source.nudge().rank())
                .thenComparingInt(CandidateSource::findingIndex)
                .thenComparingInt(CandidateSource::nudgeIndex));

        List<ReportDownloadCandidate> candidates = new ArrayList<>();
        for (int index = 0; index < sources.size(); index++) {
            CandidateSource source = sources.get(index);
            ReportDetailFindingResponse finding = source.finding();
            ReportDetailNudgeResponse nudge = source.nudge();
            String problemSummary = firstText(finding.summary(), finding.title(), "-");
            String judgementBasis = firstText(nudge.rationale(), problemSummary);

            candidates.add(new ReportDownloadCandidate(
                    index + 1,
                    firstText(nudge.title(), finding.title(), "개선 후보"),
                    stageDisplayName(finding.stage()),
                    problemLocation(finding),
                    problemSummary,
                    firstText(nudge.recommendation(), nudge.rationale(), finding.impactHypothesis(), DEFAULT_IMPROVEMENT_DIRECTION),
                    judgementBasis,
                    cleanText(nudge.expectedEffect()),
                    cleanText(nudge.difficulty()),
                    cleanText(nudge.validationQuestion()),
                    references(finding.references())
            ));
        }
        return candidates;
    }

    private ReportDownloadProblemLocation problemLocation(ReportDetailFindingResponse finding) {
        ReportFindingHighlightResponse highlight = finding.highlight();
        if (highlight == null) {
            return null;
        }

        Map<?, ?> component = problemComponent(finding.evidenceRefs());
        return new ReportDownloadProblemLocation(
                firstText(highlight.label(), readString(component, "text"), readString(component, "selector"), "EVIDENCE TARGET"),
                cleanText(readString(component, "selector")),
                cleanText(readString(component, "role")),
                cleanText(highlight.evidenceRef()),
                cleanText(highlight.screenshotArtifactId()),
                cleanText(highlight.coordinateSpace()),
                boundsLabel(highlight.bounds()),
                viewportLabel(highlight.viewport()),
                decimalText(highlight.scrollY()),
                geometry(highlight)
        );
    }

    private ReportDownloadLocationGeometry geometry(ReportFindingHighlightResponse highlight) {
        ReportFindingHighlightResponse.Bounds bounds = highlight.bounds();
        if (bounds == null) {
            return null;
        }

        ReportFindingHighlightResponse.Viewport viewport = highlight.viewport();
        return new ReportDownloadLocationGeometry(
                cleanText(bounds.unit()),
                bounds.x(),
                bounds.y(),
                bounds.width(),
                bounds.height(),
                viewport == null ? null : viewport.width(),
                viewport == null ? null : viewport.height(),
                highlight.scrollY()
        );
    }

    private Map<?, ?> problemComponent(List<Object> evidenceRefs) {
        for (Object ref : safeList(evidenceRefs)) {
            Map<?, ?> refMap = asMap(ref);
            if (refMap.isEmpty()) {
                continue;
            }

            Map<?, ?> problemComponent = readMap(refMap, "problemComponent");
            if (!problemComponent.isEmpty()) {
                return problemComponent;
            }

            problemComponent = readMap(refMap, "problem_component");
            if (!problemComponent.isEmpty()) {
                return problemComponent;
            }

            Map<?, ?> evidenceLocation = readMap(refMap, "evidenceLocation");
            Map<?, ?> locationComponent = firstMap(readList(evidenceLocation, "problem_components"));
            if (!locationComponent.isEmpty()) {
                return locationComponent;
            }
        }

        return Map.of();
    }

    private List<ReportDownloadReference> references(List<Object> rawReferences) {
        return safeList(rawReferences).stream()
                .map(this::reference)
                .filter(Objects::nonNull)
                .toList();
    }

    private ReportDownloadReference reference(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return null;
        }

        String publisher = readString(map, "publisher");
        String title = readString(map, "title");
        String basisSummary = firstPresentText(readString(map, "basisSummary"), readString(map, "basis_summary"));
        String url = readString(map, "url");

        if (publisher == null || title == null || basisSummary == null || url == null) {
            return null;
        }

        return new ReportDownloadReference(publisher, title, basisSummary, url);
    }

    private List<ReportDownloadFlowGuide> flowGuides() {
        return List.of(
                new ReportDownloadFlowGuide(
                        "전환 흐름",
                        "페이지 방문부터 가입, 구매, 문의 같은 목표 행동까지 이어지는 전체 과정입니다.",
                        new ReportDownloadReference("Google Analytics", "Funnel exploration", "목표 행동까지 이어지는 단계를 나누어 봅니다.", "https://support.google.com/analytics/answer/9327974?hl=en-GB")
                ),
                new ReportDownloadFlowGuide(
                        "첫 화면",
                        "서비스가 무엇인지, 어디서 시작해야 하는지 바로 보이는지 봅니다.",
                        new ReportDownloadReference("GOV.UK", "Start using a service", "서비스의 목적과 시작 지점이 바로 이해되는지 봅니다.", "https://design-system.service.gov.uk/patterns/start-using-a-service/")
                ),
                new ReportDownloadFlowGuide(
                        "가치 이해",
                        "얻을 가치와 필요한 조건이 행동 전에 분명히 드러나는지 봅니다.",
                        new ReportDownloadReference("NN/g", "PR on Websites", "얻을 가치와 필요한 조건이 행동 전에 분명히 드러나는지 봅니다.", "https://media.nngroup.com/media/reports/free/PR_on_Websites_3rd_Edition.pdf")
                ),
                new ReportDownloadFlowGuide(
                        "다음 행동 선택",
                        "다음에 누를 버튼이나 링크를 헷갈리지 않고 고를 수 있는지 봅니다.",
                        new ReportDownloadReference("Baymard Institute", "Button Design", "다음에 누를 버튼이나 링크가 분명한지 봅니다.", "https://baymard.com/learn/button-design")
                )
        );
    }

    private String stageDisplayName(String stage) {
        if (stage == null || stage.isBlank()) {
            return "다음 행동 선택";
        }

        return switch (stage) {
            case "FIRST_VIEW" -> "첫 화면";
            case "VALUE" -> "가치 이해";
            case "CTA", "INPUT", "COMMIT" -> "다음 행동 선택";
            default -> {
                String normalized = stage.replaceAll("[\\s/·_-]", "").toLowerCase();
                if (normalized.matches(".*(첫|first|view|보기|발견).*")) {
                    yield "첫 화면";
                }
                if (normalized.matches(".*(가치|신뢰|이해|trust|value|비교).*")) {
                    yield "가치 이해";
                }
                yield normalized.matches(".*(행동|cta|전환|선택|입력|input|commit).*") ? "다음 행동 선택" : stage;
            }
        };
    }

    private String durationLabel(RunResponse run) {
        if (run.startedAt() == null || run.finishedAt() == null) {
            return "분석 완료";
        }

        long seconds = Duration.between(run.startedAt(), run.finishedAt()).toSeconds();
        if (seconds <= 0) {
            return "분석 완료";
        }

        return seconds >= 60 ? (seconds / 60) + "분 " + (seconds % 60) + "초" : seconds + "초";
    }

    private String readString(Map<?, ?> map, String key) {
        Object value = map.get(key);
        return value instanceof String stringValue && !stringValue.isBlank() ? stringValue.trim() : null;
    }

    private Map<?, ?> asMap(Object value) {
        return value instanceof Map<?, ?> map ? map : Map.of();
    }

    private Map<?, ?> readMap(Map<?, ?> map, String key) {
        Object value = map.get(key);
        return value instanceof Map<?, ?> nested ? nested : Map.of();
    }

    private List<?> readList(Map<?, ?> map, String key) {
        Object value = map.get(key);
        return value instanceof List<?> list ? list : List.of();
    }

    private Map<?, ?> firstMap(List<?> values) {
        return values.stream()
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .findFirst()
                .orElse(Map.of());
    }

    private String boundsLabel(ReportFindingHighlightResponse.Bounds bounds) {
        if (bounds == null) {
            return null;
        }

        String unit = cleanText(bounds.unit());
        return "x=" + decimalText(bounds.x())
                + ", y=" + decimalText(bounds.y())
                + ", width=" + decimalText(bounds.width())
                + ", height=" + decimalText(bounds.height())
                + (unit == null ? "" : " (" + unit + ")");
    }

    private String viewportLabel(ReportFindingHighlightResponse.Viewport viewport) {
        if (viewport == null) {
            return null;
        }

        return decimalText(viewport.width()) + " x " + decimalText(viewport.height());
    }

    private String decimalText(BigDecimal value) {
        return value == null ? null : value.toPlainString();
    }

    private String textOrDash(String value) {
        return value == null || value.isBlank() ? "-" : value;
    }

    private String cleanText(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String firstText(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate;
            }
        }
        return "-";
    }

    private String firstPresentText(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate;
            }
        }
        return null;
    }

    private <T> List<T> safeList(List<T> values) {
        return values == null ? List.of() : values;
    }

    private record CandidateSource(
            ReportDetailFindingResponse finding,
            ReportDetailNudgeResponse nudge,
            int findingIndex,
            int nudgeIndex
    ) {
    }
}
