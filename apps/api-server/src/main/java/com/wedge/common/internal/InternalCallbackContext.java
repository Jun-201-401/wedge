package com.wedge.common.internal;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import org.springframework.util.StringUtils;

public record InternalCallbackContext(String workerId, String eventId, String signature) {
    public void validateRequired() {
        if (!StringUtils.hasText(workerId) || !StringUtils.hasText(eventId) || !StringUtils.hasText(signature)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Internal callback headers are required.");
        }
    }

    public void validateWorkerMatches(String bodyWorkerId) {
        if (bodyWorkerId != null && !workerId.equals(bodyWorkerId)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Worker id header does not match payload.");
        }
    }

    public void validateEventMatches(String bodyEventId) {
        if (bodyEventId != null && !eventId.equals(bodyEventId)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Event id header does not match payload.");
        }
    }
}
