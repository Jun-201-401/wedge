package com.wedge.analysis.api;

import com.wedge.analysis.api.dto.AnalysisRequestResponse;
import com.wedge.analysis.application.AnalysisRequestService;
import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/runs/{runId}/analysis")
public class AnalysisController {
    private final AnalysisRequestService analysisRequestService;

    public AnalysisController(AnalysisRequestService analysisRequestService) {
        this.analysisRequestService = analysisRequestService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<AnalysisRequestResponse>> requestAnalysis(
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return ApiResponse.accepted(analysisRequestService.requestPrimaryAnalysis(runId, principal(authentication).userId()));
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
