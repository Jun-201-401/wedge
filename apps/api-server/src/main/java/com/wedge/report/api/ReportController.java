package com.wedge.report.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.api.dto.RunReportResponse;
import com.wedge.report.application.ReportGenerationService;
import com.wedge.report.application.ReportQueryService;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/runs/{runId}")
public class ReportController {
    private final ReportQueryService reportQueryService;
    private final ReportGenerationService reportGenerationService;

    public ReportController(
            ReportQueryService reportQueryService,
            ReportGenerationService reportGenerationService
    ) {
        this.reportQueryService = reportQueryService;
        this.reportGenerationService = reportGenerationService;
    }

    @GetMapping("/reports")
    public ResponseEntity<ApiResponse<List<ReportSummaryResponse>>> listRunReports(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportQueryService.listRunReportSummaries(runId, principal(authentication).userId()));
    }

    @PostMapping("/report")
    public ResponseEntity<ApiResponse<RunReportResponse>> generateRunReport(@PathVariable UUID runId) {
        return ApiResponse.created(reportGenerationService.generateRunReport(runId));
    }

    @GetMapping("/report")
    public ResponseEntity<ApiResponse<RunReportResponse>> getRunReport(@PathVariable UUID runId) {
        return ApiResponse.ok(reportGenerationService.getRunReport(runId));
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
