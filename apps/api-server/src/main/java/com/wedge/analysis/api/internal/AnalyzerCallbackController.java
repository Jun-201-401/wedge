package com.wedge.analysis.api.internal;

import com.wedge.analysis.api.internal.dto.AnalyzerCallbackHeaders;
import com.wedge.analysis.api.internal.dto.AnalyzerCompletedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerFailedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerStartedRequest;
import com.wedge.analysis.application.AnalyzerCallbackService;
import com.wedge.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/analysis/jobs/{analysisJobId}")
public class AnalyzerCallbackController {
    private final AnalyzerCallbackService analyzerCallbackService;

    public AnalyzerCallbackController(AnalyzerCallbackService analyzerCallbackService) {
        this.analyzerCallbackService = analyzerCallbackService;
    }

    @PostMapping("/started")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleAnalysisStarted(
            @PathVariable UUID analysisJobId,
            @Valid @RequestBody AnalyzerStartedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(analyzerCallbackService.handleStarted(
                analysisJobId,
                request,
                callbackHeaders(workerId, eventId, signature)
        ));
    }

    @PostMapping("/completed")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleAnalysisCompleted(
            @PathVariable UUID analysisJobId,
            @Valid @RequestBody AnalyzerCompletedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(analyzerCallbackService.handleCompleted(
                analysisJobId,
                request,
                callbackHeaders(workerId, eventId, signature)
        ));
    }

    @PostMapping("/failed")
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleAnalysisFailed(
            @PathVariable UUID analysisJobId,
            @Valid @RequestBody AnalyzerFailedRequest request,
            @RequestHeader("X-Worker-Id") String workerId,
            @RequestHeader("X-Event-Id") String eventId,
            @RequestHeader("X-Signature") String signature
    ) {
        return ApiResponse.ok(analyzerCallbackService.handleFailed(
                analysisJobId,
                request,
                callbackHeaders(workerId, eventId, signature)
        ));
    }

    private AnalyzerCallbackHeaders callbackHeaders(String workerId, String eventId, String signature) {
        return new AnalyzerCallbackHeaders(workerId, eventId, signature);
    }
}
