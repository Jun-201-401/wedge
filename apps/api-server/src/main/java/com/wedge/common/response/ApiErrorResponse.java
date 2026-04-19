package com.wedge.common.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.wedge.common.error.ErrorCode;
import org.springframework.http.ResponseEntity;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiErrorResponse(
        ApiError error,
        ApiMeta meta
) {
    public static ResponseEntity<ApiErrorResponse> of(ErrorCode errorCode) {
        return of(errorCode, errorCode.message(), null);
    }

    public static ResponseEntity<ApiErrorResponse> of(ErrorCode errorCode, Object details) {
        return of(errorCode, errorCode.message(), details);
    }

    public static ResponseEntity<ApiErrorResponse> of(ErrorCode errorCode, String message, Object details) {
        ApiErrorResponse body = new ApiErrorResponse(
                new ApiError(errorCode.code(), message, details),
                RequestMetadata.current()
        );
        return ResponseEntity.status(errorCode.status()).body(body);
    }
}
