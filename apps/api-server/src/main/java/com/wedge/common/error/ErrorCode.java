package com.wedge.common.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "invalid_request", "Request is invalid."),
    VALIDATION_FAILED(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed", "Request validation failed."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "unauthorized", "Authentication is required."),
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "invalid_credentials", "Email or password is incorrect."),
    INVALID_TOKEN(HttpStatus.UNAUTHORIZED, "invalid_token", "Token is invalid."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "forbidden", "Permission is denied."),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "user_not_found", "User was not found."),
    PROJECT_NOT_FOUND(HttpStatus.NOT_FOUND, "project_not_found", "Project was not found."),
    EMAIL_ALREADY_EXISTS(HttpStatus.CONFLICT, "email_already_exists", "Email is already registered."),
    STATE_CONFLICT(HttpStatus.CONFLICT, "state_conflict", "Resource state conflict."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "Unexpected server error.");

    private final HttpStatus status;
    private final String code;
    private final String message;

    ErrorCode(HttpStatus status, String code, String message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public String message() {
        return message;
    }
}
