package com.wedge.report.application;

import com.wedge.report.api.dto.ReportShareResponse;

public record ReportShareCreationResult(
        ReportShareResponse response,
        boolean created
) {
    public static ReportShareCreationResult created(ReportShareResponse response) {
        return new ReportShareCreationResult(response, true);
    }

    public static ReportShareCreationResult reused(ReportShareResponse response) {
        return new ReportShareCreationResult(response, false);
    }
}
