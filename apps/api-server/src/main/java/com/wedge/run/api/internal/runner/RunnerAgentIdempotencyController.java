package com.wedge.run.api.internal.runner;

import com.wedge.common.response.ApiResponse;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordRequest;
import com.wedge.run.api.internal.runner.dto.RunnerAgentIdempotencyRecordResponse;
import com.wedge.run.application.RunnerAgentIdempotencyService;
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
@RequestMapping("/internal/runner/agent-idempotency/{idempotencyKeyHash}")
@RequiredArgsConstructor
public class RunnerAgentIdempotencyController {
    private final RunnerAgentIdempotencyService runnerAgentIdempotencyService;

    @GetMapping
    public ResponseEntity<ApiResponse<RunnerAgentIdempotencyRecordResponse>> findRecord(
            @PathVariable String idempotencyKeyHash
    ) {
        return ApiResponse.ok(runnerAgentIdempotencyService.findRecord(idempotencyKeyHash));
    }

    @PutMapping
    public ResponseEntity<ApiResponse<RunnerAgentIdempotencyRecordResponse>> persistRecord(
            @PathVariable String idempotencyKeyHash,
            @Valid @RequestBody RunnerAgentIdempotencyRecordRequest request
    ) {
        return ApiResponse.ok(runnerAgentIdempotencyService.persistRecord(idempotencyKeyHash, request));
    }
}
