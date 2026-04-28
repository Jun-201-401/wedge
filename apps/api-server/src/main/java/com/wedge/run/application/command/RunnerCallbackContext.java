package com.wedge.run.application.command;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import org.springframework.util.StringUtils;

public record RunnerCallbackContext(String workerId, String eventId, String signature) {
    public void validateRequired() {
        if (!StringUtils.hasText(workerId) || !StringUtils.hasText(eventId) || !StringUtils.hasText(signature)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Runner callback headers are required.");
        }
    }

    public void validateWorkerMatches(String bodyWorkerId) {
        if (bodyWorkerId != null && !workerId.equals(bodyWorkerId)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Runner worker id header does not match payload.");
        }
    }
}
