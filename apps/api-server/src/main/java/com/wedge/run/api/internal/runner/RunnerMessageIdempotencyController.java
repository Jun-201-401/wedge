package com.wedge.run.api.internal.runner;

import com.wedge.common.response.ApiResponse;
import com.wedge.run.api.internal.runner.dto.RunnerMessageIdempotencyRecordRequest;
import com.wedge.run.api.internal.runner.dto.RunnerMessageIdempotencyRecordResponse;
import com.wedge.run.application.RunnerMessageIdempotencyService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/runner/message-idempotency/{scope}/{idempotencyKeyHash}")
@RequiredArgsConstructor
public class RunnerMessageIdempotencyController {
    private final RunnerMessageIdempotencyService runnerMessageIdempotencyService;

    @GetMapping
    public ResponseEntity<ApiResponse<RunnerMessageIdempotencyRecordResponse>> findRecord(
            @PathVariable String scope,
            @PathVariable String idempotencyKeyHash
    ) {
        return ApiResponse.ok(runnerMessageIdempotencyService.findRecord(scope, idempotencyKeyHash));
    }

    @PutMapping
    public ResponseEntity<ApiResponse<RunnerMessageIdempotencyRecordResponse>> persistRecord(
            @PathVariable String scope,
            @PathVariable String idempotencyKeyHash,
            @Valid @RequestBody RunnerMessageIdempotencyRecordRequest request
    ) {
        return ApiResponse.ok(runnerMessageIdempotencyService.persistRecord(scope, idempotencyKeyHash, request));
    }
}
