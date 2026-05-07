package com.wedge.mcp.application;

import com.wedge.mcp.api.dto.GetRunStatusResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class McpRunQueryService {
    private final RunService runService;

    @Transactional(readOnly = true)
    public GetRunStatusResponse getRunStatus(UUID runId) {
        RunResponse run = runService.getRun(runId);
        return GetRunStatusResponse.from(run);
    }
}
