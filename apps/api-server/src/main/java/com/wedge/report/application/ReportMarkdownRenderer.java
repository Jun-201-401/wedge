package com.wedge.report.application;

import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.run.api.dto.RunResponse;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ReportMarkdownRenderer {
    private final ReportDownloadDocumentBuilder documentBuilder;

    public byte[] render(ReportDetailResponse report, RunResponse run) {
        ReportDownloadDocument document = documentBuilder.build(report, run);
        StringBuilder markdown = new StringBuilder();
        appendHeading(markdown, 1, "전환 흐름 리포트");
        appendLine(markdown, "");
        appendMetadata(markdown, document);
        appendCandidates(markdown, document);
        appendFlowGuide(markdown, document);
        appendFlowGuideReferences(markdown, document);
        return markdown.toString().getBytes(StandardCharsets.UTF_8);
    }

    private void appendMetadata(StringBuilder markdown, ReportDownloadDocument document) {
        appendHeading(markdown, 2, "리포트 대상 정보");
        appendBullet(markdown, "분석 대상", document.targetUrl());
        appendBullet(markdown, "점검 흐름", document.goal());
        appendBullet(markdown, "총 단계", String.valueOf(document.totalSteps()));
        appendBullet(markdown, "마찰 지점", String.valueOf(document.findingCount()));
        appendBullet(markdown, "소요 시간", document.durationLabel());
        appendBullet(markdown, "리포트 ID", String.valueOf(document.reportId()));
        appendBullet(markdown, "실행 ID", String.valueOf(document.runId()));
        appendBullet(markdown, "생성 시각", document.createdAt());
        appendLine(markdown, "");
    }

    private void appendCandidates(StringBuilder markdown, ReportDownloadDocument document) {
        appendHeading(markdown, 2, "개선 후보");
        if (document.candidates().isEmpty()) {
            appendLine(markdown, "현재 우선 수정할 항목은 없습니다.");
            appendLine(markdown, "");
            return;
        }

        for (ReportDownloadCandidate candidate : document.candidates()) {
            appendHeading(markdown, 3, "Nudge " + twoDigit(candidate.order()) + ". " + candidate.title());
            appendBullet(markdown, "전환 단계", candidate.stage());
            appendProblemLocation(markdown, candidate.location());
            appendParagraph(markdown, "문제 요약", candidate.problemSummary());
            appendParagraph(markdown, "개선 방향", candidate.improvementDirection());
            appendParagraph(markdown, "판단 근거", candidate.judgementBasis());
            appendOptionalBullet(markdown, "기대 효과", candidate.expectedEffect());
            appendOptionalBullet(markdown, "난이도", candidate.difficulty());
            appendOptionalBullet(markdown, "검증 질문", candidate.validationQuestion());
            appendCandidateReferences(markdown, candidate);
            appendLine(markdown, "");
        }
    }

    private void appendProblemLocation(StringBuilder markdown, ReportDownloadProblemLocation location) {
        if (location == null) {
            return;
        }

        appendHeading(markdown, 4, "문제 컴포넌트 위치");
        appendOptionalBullet(markdown, "레이블", location.label());
        appendOptionalBullet(markdown, "CSS selector", location.selector());
        appendOptionalBullet(markdown, "역할", location.role());
        appendOptionalBullet(markdown, "좌표", location.bounds());
        appendOptionalBullet(markdown, "Viewport", location.viewport());
        appendOptionalBullet(markdown, "Scroll Y", location.scrollY());
        appendOptionalBullet(markdown, "좌표 기준", location.coordinateSpace());
    }

    private void appendCandidateReferences(StringBuilder markdown, ReportDownloadCandidate candidate) {
        if (candidate.references().isEmpty()) {
            return;
        }

        appendHeading(markdown, 4, "참고 기준");
        for (ReportDownloadReference reference : candidate.references()) {
            appendLine(markdown, "- **" + inlineText(reference.publisher()) + " / " + inlineText(reference.title()) + "**");
            appendLine(markdown, "  - " + inlineText(reference.basisSummary()));
            appendLine(markdown, "  - " + inlineText(reference.url()));
        }
    }

    private void appendFlowGuide(StringBuilder markdown, ReportDownloadDocument document) {
        appendHeading(markdown, 2, "단계별 판단 기준");
        appendLine(markdown, "Wedge는 사용자가 페이지를 보고 행동을 결정하는 과정을 세 단계로 나누어 확인합니다.");
        appendLine(markdown, "");
        appendLine(markdown, "| 단계 | 판단 기준 |");
        appendLine(markdown, "| --- | --- |");
        for (ReportDownloadFlowGuide guide : document.flowGuides()) {
            if ("전환 흐름".equals(guide.label())) {
                continue;
            }
            appendLine(markdown, "| " + inlineText(guide.label()) + " | " + inlineText(guide.description()) + " |");
        }
        appendLine(markdown, "");
    }

    private void appendFlowGuideReferences(StringBuilder markdown, ReportDownloadDocument document) {
        appendHeading(markdown, 2, "기준 근거");
        for (ReportDownloadFlowGuide guide : document.flowGuides()) {
            ReportDownloadReference reference = guide.reference();
            appendLine(markdown, "- **" + inlineText(guide.label()) + "**: "
                    + inlineText(reference.publisher()) + " / " + inlineText(reference.title()));
            appendLine(markdown, "  - " + inlineText(reference.basisSummary()));
            appendLine(markdown, "  - " + inlineText(reference.url()));
        }
    }

    private void appendHeading(StringBuilder markdown, int level, String text) {
        appendLine(markdown, "#".repeat(level) + " " + inlineText(text));
    }

    private void appendBullet(StringBuilder markdown, String label, String value) {
        appendLine(markdown, "- **" + inlineText(label) + "**: " + inlineText(value));
    }

    private void appendOptionalBullet(StringBuilder markdown, String label, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        appendBullet(markdown, label, value);
    }

    private void appendParagraph(StringBuilder markdown, String label, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        appendLine(markdown, "**" + inlineText(label) + "**: " + inlineText(value));
    }

    private void appendLine(StringBuilder markdown, String line) {
        markdown.append(line).append('\n');
    }

    private static String twoDigit(int value) {
        return String.format("%02d", value);
    }

    private static String inlineText(String value) {
        String normalized = value == null ? "-" : value.replace('\r', ' ').replace('\n', ' ').trim();
        if (normalized.isEmpty()) {
            return "-";
        }
        return normalized
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\\", "\\\\")
                .replace("`", "\\`")
                .replace("*", "\\*")
                .replace("_", "\\_")
                .replace("[", "\\[")
                .replace("]", "\\]")
                .replace("|", "\\|");
    }
}
