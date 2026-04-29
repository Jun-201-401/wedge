package com.wedge.internal.analysis.dto;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;

public record AnalyzerCallbackHeaders(String workerId, String eventId, String signature) {
    public void validateRequired() {
        if (isBlank(workerId) || isBlank(eventId) || isBlank(signature)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Analyzer callback headers are required.");
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
