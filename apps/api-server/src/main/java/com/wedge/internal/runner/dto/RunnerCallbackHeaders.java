package com.wedge.internal.runner.dto;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;

public record RunnerCallbackHeaders(String workerId, String eventId, String signature) {

    public void validateWorkerMatches(String bodyWorkerId) {
        if (bodyWorkerId != null && !workerId.equals(bodyWorkerId)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Runner worker id header does not match payload.");
        }
    }
}
