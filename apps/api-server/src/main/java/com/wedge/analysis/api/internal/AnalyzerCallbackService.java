package com.wedge.analysis.api.internal;

import com.wedge.analysis.api.internal.dto.AnalyzerCallbackHeaders;
import com.wedge.analysis.api.internal.dto.AnalyzerCompletedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerFailedRequest;
import com.wedge.analysis.application.JudgeResultPersistenceService;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnalyzerCallbackService {
    private static final String COMPLETED_CONSUMER = "analyzer.completed";
    private static final String FAILED_CONSUMER = "analyzer.failed";

    private final JudgeResultPersistenceService judgeResultPersistenceService;
    private final ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    public AnalyzerCallbackService(
            JudgeResultPersistenceService judgeResultPersistenceService,
            ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter
    ) {
        this.judgeResultPersistenceService = judgeResultPersistenceService;
        this.processedMessagePersistenceAdapter = processedMessagePersistenceAdapter;
    }

    @Transactional
    public Map<String, Object> handleCompleted(
            UUID analysisJobId,
            AnalyzerCompletedRequest request,
            AnalyzerCallbackHeaders headers
    ) {
        headers.validateRequired();
        validateAnalysisJobId(analysisJobId, request.analysisJobId());
        if (isDuplicate(COMPLETED_CONSUMER, headers.eventId())) {
            return duplicateResponse(analysisJobId, request.runId(), "COMPLETED");
        }
        return judgeResultPersistenceService.saveCompleted(request);
    }

    @Transactional
    public Map<String, Object> handleFailed(UUID analysisJobId, AnalyzerFailedRequest request, AnalyzerCallbackHeaders headers) {
        headers.validateRequired();
        validateAnalysisJobId(analysisJobId, request.analysisJobId());
        if (isDuplicate(FAILED_CONSUMER, headers.eventId())) {
            return duplicateResponse(analysisJobId, request.runId(), "FAILED");
        }
        return judgeResultPersistenceService.saveFailed(request);
    }

    private void validateAnalysisJobId(UUID pathId, UUID bodyId) {
        if (!pathId.equals(bodyId)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Analyzer callback analysisJobId does not match path.");
        }
    }

    private boolean isDuplicate(String consumerName, String eventId) {
        return !processedMessagePersistenceAdapter.tryMarkProcessed(consumerName, eventId);
    }

    private Map<String, Object> duplicateResponse(UUID analysisJobId, UUID runId, String status) {
        return Map.of("analysisJobId", analysisJobId, "runId", runId, "status", status, "duplicate", true);
    }
}
