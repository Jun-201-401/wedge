package com.wedge.report.api.dto;

import com.wedge.report.domain.ReportFormat;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record ReportCreateRequest(
        @NotNull ReportFormat format,
        UUID analysisJobId
) {
}
