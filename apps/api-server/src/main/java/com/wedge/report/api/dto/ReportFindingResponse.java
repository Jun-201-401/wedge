package com.wedge.report.api.dto;

import com.wedge.analysis.domain.AnalysisFinding;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record ReportFindingResponse(
        UUID id,
        Integer rankOrder,
        String title,
        String summary,
        String category,
        String stage,
        String axis,
        Integer severity,
        BigDecimal confidence,
        BigDecimal priorityScore,
        String impactHypothesis,
        List<Object> evidenceRefs,
        List<Object> references
) {
    public static ReportFindingResponse from(AnalysisFinding finding, List<Object> evidenceRefs, List<Object> references) {
        return new ReportFindingResponse(
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
                references
        );
    }
}
