package com.wedge.common.response;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

public record ApiResponse<T>(
        T data,
        ApiMeta meta
) {
    public static <T> ResponseEntity<ApiResponse<T>> ok(T data) {
        return ResponseEntity.ok(body(data));
    }

    public static <T> ResponseEntity<ApiResponse<T>> created(T data) {
        return ResponseEntity.status(HttpStatus.CREATED).body(body(data));
    }

    public static <T> ResponseEntity<ApiResponse<T>> accepted(T data) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(body(data));
    }

    public static ResponseEntity<ApiResponse<Void>> noData() {
        return ResponseEntity.ok(body(null));
    }

    public static <T> ApiResponse<T> body(T data) {
        return new ApiResponse<>(data, RequestMetadata.current());
    }
}
