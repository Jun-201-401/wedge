package com.wedge.report.application;

import com.wedge.report.api.dto.DecisionMapItemResponse;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.run.api.dto.RunResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ReportMarkdownRenderer {
    public byte[] render(ReportDetailResponse report, RunResponse run) {
        StringBuilder markdown = new StringBuilder();
        appendHeading(markdown, 1, firstText(report.title(), "Wedge Report"));
        appendLine(markdown, "");
        appendMetadata(markdown, report, run);
        appendSummary(markdown, report);
        appendDecisionMap(markdown, report.decisionMap());
        appendFindings(markdown, report.findings());
        return markdown.toString().getBytes(StandardCharsets.UTF_8);
    }

    private void appendMetadata(StringBuilder markdown, ReportDetailResponse report, RunResponse run) {
        appendHeading(markdown, 2, "Report");
        appendBullet(markdown, "Run", String.valueOf(report.runId()));
        appendBullet(markdown, "Target URL", run.startUrl() == null ? "-" : run.startUrl().toString());
        appendBullet(markdown, "Goal", textOrDash(run.goal()));
        appendBullet(markdown, "Source format", String.valueOf(report.format()));
        appendBullet(markdown, "Created at", report.createdAt() == null ? "-" : report.createdAt().toString());
        appendLine(markdown, "");
    }

    private void appendSummary(StringBuilder markdown, ReportDetailResponse report) {
        appendHeading(markdown, 2, "Summary");
        appendBullet(markdown, "Friction score", report.frictionScore() == null ? "-" : report.frictionScore().toPlainString());
        appendBullet(markdown, "Finding count", String.valueOf(report.findings().size()));
        appendBullet(markdown, "Initial display count", String.valueOf(report.initialDisplayCount()));
        if (report.summary() != null && !report.summary().isEmpty()) {
            for (Map.Entry<String, Object> entry : report.summary().entrySet()) {
                appendBullet(markdown, entry.getKey(), String.valueOf(entry.getValue()));
            }
        }
        appendLine(markdown, "");
    }

    private void appendDecisionMap(StringBuilder markdown, List<DecisionMapItemResponse> decisionMap) {
        appendHeading(markdown, 2, "Decision Map");
        if (decisionMap == null || decisionMap.isEmpty()) {
            appendLine(markdown, "- No decision map items.");
            appendLine(markdown, "");
            return;
        }

        for (DecisionMapItemResponse item : decisionMap) {
            appendLine(markdown, "- **" + inlineText(item.displayName()) + "** [" + inlineText(item.status()) + "] " + inlineText(item.summary()));
            if (item.stage() != null && !item.stage().isBlank()) {
                appendLine(markdown, "  - Stage: " + inlineText(item.stage()));
            }
        }
        appendLine(markdown, "");
    }

    private void appendFindings(StringBuilder markdown, List<ReportDetailFindingResponse> findings) {
        appendHeading(markdown, 2, "Findings and Recommendations");
        if (findings == null || findings.isEmpty()) {
            appendLine(markdown, "- No findings.");
            return;
        }

        for (ReportDetailFindingResponse finding : findings) {
            appendHeading(markdown, 3, finding.rank() + ". " + firstText(finding.title(), "Untitled finding"));
            appendBullet(markdown, "Stage", textOrDash(finding.stage()));
            appendBullet(markdown, "Severity", finding.severity() == null ? "-" : String.valueOf(finding.severity()));
            appendBullet(markdown, "Confidence", finding.confidence() == null ? "-" : finding.confidence().toPlainString());
            appendParagraph(markdown, "Summary", finding.summary());
            appendParagraph(markdown, "Impact", finding.impactHypothesis());
            appendNudges(markdown, finding.nudges());
            appendLine(markdown, "");
        }
    }

    private void appendNudges(StringBuilder markdown, List<ReportDetailNudgeResponse> nudges) {
        if (nudges == null || nudges.isEmpty()) {
            return;
        }

        appendLine(markdown, "**Recommendations**");
        for (ReportDetailNudgeResponse nudge : nudges) {
            appendLine(markdown, "- **" + inlineText(firstText(nudge.title(), "Recommendation")) + "**: "
                    + inlineText(firstText(nudge.recommendation(), nudge.rationale(), nudge.expectedEffect(), "Review this improvement candidate.")));
            if (nudge.validationQuestion() != null && !nudge.validationQuestion().isBlank()) {
                appendLine(markdown, "  - Validation: " + inlineText(nudge.validationQuestion()));
            }
        }
    }

    private void appendHeading(StringBuilder markdown, int level, String text) {
        appendLine(markdown, "#".repeat(level) + " " + inlineText(text));
    }

    private void appendBullet(StringBuilder markdown, String label, String value) {
        appendLine(markdown, "- **" + inlineText(label) + "**: " + inlineText(value));
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

    private static String firstText(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate;
            }
        }
        return "-";
    }

    private static String textOrDash(String value) {
        return value == null || value.isBlank() ? "-" : value;
    }

    private static String inlineText(String value) {
        String normalized = value == null ? "-" : value.replace('\r', ' ').replace('\n', ' ').trim();
        if (normalized.isEmpty()) {
            return "-";
        }
        return normalized
                .replace("\\", "\\\\")
                .replace("`", "\\`")
                .replace("*", "\\*")
                .replace("_", "\\_")
                .replace("[", "\\[")
                .replace("]", "\\]");
    }
}
