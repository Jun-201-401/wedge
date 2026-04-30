package com.wedge.report.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.application.ReportDetailQueryService;
import com.wedge.report.application.ReportSummaryQueryService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ReportController {
    private final ReportSummaryQueryService reportSummaryQueryService;
    private final ReportDetailQueryService reportDetailQueryService;

    @GetMapping("/api/runs/{runId}/reports")
    public ResponseEntity<ApiResponse<List<ReportSummaryResponse>>> listRunReports(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportSummaryQueryService.listRunReportSummaries(runId, principal(authentication).userId()));
    }

    @GetMapping("/api/reports/{reportId}")
    public ResponseEntity<ApiResponse<ReportDetailResponse>> getReport(
            @PathVariable UUID reportId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportDetailQueryService.getReportDetail(reportId, principal(authentication).userId()));
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
