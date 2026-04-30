package com.wedge.report.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.application.ReportQueryService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/runs/{runId}/reports")
@RequiredArgsConstructor
public class ReportController {
    private final ReportQueryService reportQueryService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<ReportSummaryResponse>>> listRunReports(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportQueryService.listRunReportSummaries(runId, principal(authentication).userId()));
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
