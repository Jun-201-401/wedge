package com.wedge.common.error;

public class BusinessException extends RuntimeException {
    private final ErrorCode errorCode;
    private final Object details;

    public BusinessException(ErrorCode errorCode) {
        this(errorCode, errorCode.message(), null, null);
    }

    public BusinessException(ErrorCode errorCode, Object details) {
        this(errorCode, errorCode.message(), details, null);
    }

    public BusinessException(ErrorCode errorCode, String message) {
        this(errorCode, message, null, null);
    }

    public BusinessException(ErrorCode errorCode, String message, Object details) {
        this(errorCode, message, details, null);
    }

    public BusinessException(ErrorCode errorCode, String message, Object details, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.details = details;
    }

    public ErrorCode errorCode() {
        return errorCode;
    }

    public Object details() {
        return details;
    }
}
