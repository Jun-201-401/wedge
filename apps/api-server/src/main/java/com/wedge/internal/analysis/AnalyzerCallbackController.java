package com.wedge.internal.analysis;

import com.wedge.common.response.ApiResponse;
import com.wedge.internal.analysis.dto.AnalyzerCallbackHeaders;
import com.wedge.internal.analysis.dto.AnalyzerCompletedRequest;
import com.wedge.internal.analysis.dto.AnalyzerFailedRequest;
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
