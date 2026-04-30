package com.wedge.report.api.dto;

import java.util.List;

public record DecisionMapItemResponse(
        String stage,
        String displayName,
        String status,
        List<String> issueIds,
        String summary,
        List<String> evidenceRefs
) {
}
