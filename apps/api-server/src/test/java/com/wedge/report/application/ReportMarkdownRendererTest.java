package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.wedge.report.api.dto.DecisionMapItemResponse;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportFindingHighlightResponse;
import com.wedge.report.domain.ReportFormat;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ReportStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ReportMarkdownRendererTest {
    private final ReportMarkdownRenderer renderer = new ReportMarkdownRenderer(new ReportDownloadDocumentBuilder());

    @Test
    void renderIncludesAllNudgesInFindingAndNudgeRankOrder() {
        ReportDetailFindingResponse laterFinding = finding(
                2,
                "가치 설명이 행동 뒤에 숨어 있습니다",
                "가격과 도입 조건이 CTA 이후에야 확인됩니다.",
                "VALUE",
                List.of(nudge(2, "가격 조건 먼저 노출", "가격 조건이 늦게 드러납니다.", "CTA 이전에 가격 조건을 요약하세요"),
                        nudge(1, "핵심 가치 먼저 제시", "가치 이해 전에 행동을 요구합니다.", "첫 화면에 기대 효과를 먼저 보여주세요")),
                List.of(reference("NN/g", "PR on Websites", "가치와 조건이 행동 전에 드러나는지 봅니다.", "https://example.com/value"))
        );
        ReportDetailFindingResponse firstFinding = finding(
                1,
                "클릭 대상이 작습니다",
                "일부 클릭 대상이 작거나 가까이 배치되어 사용자가 정확히 누르기 어려울 수 있습니다.",
                "CTA",
                List.of(nudge(2, "간격 확보", "클릭 대상 사이 간격이 부족합니다.", "주요 버튼 사이 간격을 확보하세요"),
                        nudge(1, "터치 영역 확대", "클릭 대상이 작습니다.", "주요 버튼과 아이콘 버튼은 최소 24px 이상으로 확보하세요")),
                List.of(reference("CHROME", "Tap targets are not sized appropriately", "클릭 대상이 작으면 정확히 선택하기 어렵습니다.", "https://example.com/tap-targets")),
                locationEvidence(),
                highlight()
        );

        String markdown = render(detail(List.of(laterFinding, firstFinding)), run());

        assertThat(markdown).contains("# 전환 흐름 리포트");
        assertThat(markdown).contains("## 리포트 대상 정보", "## 개선 후보", "## 단계별 판단 기준", "## 기준 근거");
        assertThat(markdown).doesNotContain("## 먼저 고칠 항목", "개선 후보를 선택하면 진단과 관련 근거가 함께 바뀝니다.", "마찰 점수");
        assertThat(markdown).containsSubsequence(
                "### Nudge 01. 터치 영역 확대",
                "### Nudge 02. 간격 확보",
                "### Nudge 03. 핵심 가치 먼저 제시",
                "### Nudge 04. 가격 조건 먼저 노출"
        );
        assertThat(markdown).contains(
                "- **전환 단계**: 다음 행동 선택",
                "#### 문제 컴포넌트 위치",
                "- **레이블**: Start free",
                "- **CSS selector**: button\\[data-testid=\"start\"\\]",
                "- **역할**: button",
                "- **좌표**: x=520.0, y=120.0, width=96.0, height=44.0 (css\\_px)",
                "- **Viewport**: 1440.0 x 900.0",
                "- **Scroll Y**: 640.0",
                "- **좌표 기준**: viewport",
                "**문제 요약**: 일부 클릭 대상이 작거나 가까이 배치되어 사용자가 정확히 누르기 어려울 수 있습니다.",
                "**개선 방향**: 주요 버튼과 아이콘 버튼은 최소 24px 이상으로 확보하세요",
                "**판단 근거**: 클릭 대상이 작습니다.",
                "- **기대 효과**: 전환 판단 근거 강화",
                "- **난이도**: 낮음",
                "- **검증 질문**: 수정 후 같은 흐름에서 이 마찰이 다시 발생하지 않는지 확인하세요.",
                "#### 참고 기준",
                "- **CHROME / Tap targets are not sized appropriately**",
                "https://example.com/tap-targets"
        );
        assertThat(markdown).doesNotContain("Evidence ref", "Screenshot artifact", "checkpoint-1.component_001", "artifact-123");
        assertThat(markdown).doesNotContain("## Decision Map", "## Findings and Recommendations");
    }

    @Test
    void renderShowsEmptyStateWhenNoNudgesExist() {
        ReportDetailFindingResponse finding = finding(
                1,
                "큰 마찰은 발견되지 않았습니다",
                "이번 실행에서는 전환을 크게 막는 마찰이 발견되지 않았습니다.",
                "FIRST_VIEW",
                List.of(),
                List.of()
        );

        String markdown = render(detail(List.of(finding)), run());

        assertThat(markdown).contains(
                "## 개선 후보",
                "현재 우선 수정할 항목은 없습니다"
        );
        assertThat(markdown).doesNotContain("## 먼저 고칠 항목", "사용자가 지나간 단계에서 큰 전환 마찰이 발견되지 않았습니다.");
    }

    @Test
    void renderEscapesMarkdownControlCharacters() {
        ReportDetailFindingResponse finding = finding(
                1,
                "CTA [버튼]이 `작음`",
                "요약에 *강조*와 _밑줄_ 그리고 | 문자가 있습니다. <img src=x onerror=alert(1)> & <script>",
                "CTA",
                List.of(nudge(1, "버튼 `크기` [확대]", "근거에 *문자*가 있습니다.", "추천에 _문자_와 | 문자가 있습니다.")),
                List.of()
        );

        String markdown = render(detail(List.of(finding)), run());

        assertThat(markdown).contains(
                "### Nudge 01. 버튼 \\`크기\\` \\[확대\\]",
                "\\*문자\\*",
                "\\_문자\\_",
                "\\|",
                "&lt;img src=x onerror=alert(1)&gt; &amp; &lt;script&gt;"
        );
    }

    @Test
    void renderIgnoresIncompleteReferenceEntries() {
        ReportDetailFindingResponse finding = finding(
                1,
                "클릭 대상이 작습니다",
                "일부 클릭 대상이 작거나 가까이 배치되어 사용자가 정확히 누르기 어려울 수 있습니다.",
                "CTA",
                List.of(nudge(1, "터치 영역 확대", "클릭 대상이 작습니다.", "주요 버튼과 아이콘 버튼은 최소 24px 이상으로 확보하세요")),
                List.of(Map.of(
                        "publisher", "CHROME",
                        "title", "Tap targets are not sized appropriately",
                        "url", "https://example.com/tap-targets"
                ))
        );

        String markdown = render(detail(List.of(finding)), run());

        assertThat(markdown).doesNotContain("#### 참고 기준", "Tap targets are not sized appropriately");
    }

    private String render(ReportDetailResponse report, RunResponse run) {
        return new String(renderer.render(report, run), StandardCharsets.UTF_8);
    }

    private RunResponse run() {
        return new RunResponse(
                UUID.randomUUID(),
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
                3,
                OffsetDateTime.parse("2026-05-19T00:59:00Z"),
                OffsetDateTime.parse("2026-05-19T01:00:12Z"),
                null,
                null,
                null
        );
    }

    private ReportDetailResponse detail(List<ReportDetailFindingResponse> findings) {
        return new ReportDetailResponse(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                "전환 마찰 리포트",
                ReportFormat.JSON,
                ReportStatus.READY,
                BigDecimal.valueOf(72),
                Map.of("핵심 요약", "CTA 명확성 개선 필요"),
                List.of(new DecisionMapItemResponse("FIRST_VIEW", "첫 화면", "FRICTION", List.of("F-1"), "첫 화면에서 마찰이 감지됐습니다.", List.of("artifact:1"))),
                3,
                findings,
                OffsetDateTime.of(2026, 5, 19, 1, 0, 0, 0, ZoneOffset.UTC)
        );
    }

    private ReportDetailFindingResponse finding(
            int rank,
            String title,
            String summary,
            String stage,
            List<ReportDetailNudgeResponse> nudges,
            List<Object> references
    ) {
        return finding(rank, title, summary, stage, nudges, references, List.of("evidence:1"), null);
    }

    private ReportDetailFindingResponse finding(
            int rank,
            String title,
            String summary,
            String stage,
            List<ReportDetailNudgeResponse> nudges,
            List<Object> references,
            List<Object> evidenceRefs,
            ReportFindingHighlightResponse highlight
    ) {
        return new ReportDetailFindingResponse(
                UUID.randomUUID(),
                rank,
                title,
                summary,
                "conversion",
                stage,
                "clarity",
                3,
                BigDecimal.valueOf(0.91),
                BigDecimal.valueOf(0.82),
                "사용자가 다음 행동을 결정하기 전에 판단 근거를 얻지 못할 수 있습니다.",
                evidenceRefs,
                references,
                null,
                highlight,
                nudges
        );
    }

    private ReportDetailNudgeResponse nudge(int rank, String title, String rationale, String recommendation) {
        return new ReportDetailNudgeResponse(
                UUID.randomUUID(),
                rank,
                title,
                rationale,
                recommendation,
                "낮음",
                "전환 판단 근거 강화",
                "수정 후 같은 흐름에서 이 마찰이 다시 발생하지 않는지 확인하세요."
        );
    }

    private Map<String, Object> reference(String publisher, String title, String basisSummary, String url) {
        return Map.of(
                "label", "기준",
                "publisher", publisher,
                "title", title,
                "basisSummary", basisSummary,
                "url", url
        );
    }

    private ReportFindingHighlightResponse highlight() {
        return new ReportFindingHighlightResponse(
                "checkpoint-1.component_001",
                "Start free",
                "artifact-coordinate",
                "viewport",
                new ReportFindingHighlightResponse.Bounds(
                        BigDecimal.valueOf(520.0),
                        BigDecimal.valueOf(120.0),
                        BigDecimal.valueOf(96.0),
                        BigDecimal.valueOf(44.0),
                        "css_px"
                ),
                new ReportFindingHighlightResponse.Viewport(BigDecimal.valueOf(1440.0), BigDecimal.valueOf(900.0)),
                BigDecimal.valueOf(640.0),
                "artifact-123"
        );
    }

    private List<Object> locationEvidence() {
        return List.of(Map.of(
                "problemComponent", Map.of(
                        "label", "Start free",
                        "selector", "button[data-testid=\"start\"]",
                        "role", "button",
                        "bounding_box", Map.of(
                                "x", BigDecimal.valueOf(520.0),
                                "y", BigDecimal.valueOf(120.0),
                                "width", BigDecimal.valueOf(96.0),
                                "height", BigDecimal.valueOf(44.0),
                                "unit", "css_px"
                        ),
                        "viewport", Map.of(
                                "width", BigDecimal.valueOf(1440.0),
                                "height", BigDecimal.valueOf(900.0)
                        ),
                        "screenshot_artifact_id", "artifact-123"
                )
        ));
    }
}
