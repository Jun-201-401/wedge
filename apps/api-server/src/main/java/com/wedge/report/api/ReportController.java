package com.wedge.report.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportShareResponse;
import com.wedge.report.api.dto.ReportSummaryResponse;
import com.wedge.report.api.dto.RunReportResponse;
import com.wedge.report.application.ReportGenerationService;
import com.wedge.report.application.ReportDetailQueryService;
import com.wedge.report.application.ReportShareCreationResult;
import com.wedge.report.application.ReportSummaryQueryService;
import com.wedge.report.application.ReportShareService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ReportController {
    private final ReportSummaryQueryService reportSummaryQueryService;
    private final ReportDetailQueryService reportDetailQueryService;
    private final ReportGenerationService reportGenerationService;
    private final ReportShareService reportShareService;

    @GetMapping("/api/runs/{runId}/reports")
    public ResponseEntity<ApiResponse<List<ReportSummaryResponse>>> listRunReports(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportSummaryQueryService.listRunReportSummaries(runId, principal(authentication).userId()));
    }

    @PostMapping("/api/runs/{runId}/report")
    public ResponseEntity<ApiResponse<RunReportResponse>> generateRunReport(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.created(reportGenerationService.generateRunReport(runId, principal(authentication).userId()));
    }

    @GetMapping("/api/runs/{runId}/report")
    public ResponseEntity<ApiResponse<RunReportResponse>> getRunReport(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportGenerationService.getRunReport(runId, principal(authentication).userId()));
    }

    @GetMapping("/api/reports/{reportId}")
    public ResponseEntity<ApiResponse<ReportDetailResponse>> getReport(
            @PathVariable UUID reportId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportDetailQueryService.getReportDetail(reportId, principal(authentication).userId()));
    }

    @GetMapping("/api/reports/{reportId}/shares")
    public ResponseEntity<ApiResponse<List<ReportShareResponse>>> listReportShares(
            @PathVariable UUID reportId,
            Authentication authentication
    ) {
        return ApiResponse.ok(reportShareService.listReportShares(reportId, principal(authentication).userId()));
    }

    @PostMapping("/api/reports/{reportId}/shares")
    public ResponseEntity<ApiResponse<ReportShareResponse>> createReportShare(
            @PathVariable UUID reportId,
            Authentication authentication
    ) {
        ReportShareCreationResult result = reportShareService.createReportShare(reportId, principal(authentication).userId());
        if (result.created()) {
            return ApiResponse.created(result.response());
        }
        return ApiResponse.ok(result.response());
    }

    @DeleteMapping("/api/reports/{reportId}/shares/{shareId}")
    public ResponseEntity<ApiResponse<Void>> revokeReportShare(
            @PathVariable UUID reportId,
            @PathVariable UUID shareId,
            Authentication authentication
    ) {
        reportShareService.revokeReportShare(reportId, shareId, principal(authentication).userId());
        return ApiResponse.noData();
    }

    @GetMapping("/api/report-shares/{shareToken}")
    public ResponseEntity<ApiResponse<ReportDetailResponse>> getSharedReport(
            @PathVariable String shareToken
    ) {
        return ApiResponse.ok(reportShareService.getSharedReport(shareToken));
    }

    @GetMapping("/api/report-shares/{shareToken}/artifacts/{artifactId}/content")
    public ResponseEntity<Resource> getSharedReportArtifactContent(
            @PathVariable String shareToken,
            @PathVariable UUID artifactId
    ) {
        EvidenceService.ArtifactContent artifactContent = reportShareService.getSharedArtifactContent(shareToken, artifactId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(artifactContent.mimeType()))
                .body(artifactContent.resource());
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
