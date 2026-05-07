package com.wedge.run.application;

import com.wedge.run.api.dto.RunEventResponse;
import java.util.List;

public record RunEventListResult(
        List<RunEventResponse> events,
        String nextCursor,
        boolean hasMore
) {
    public RunEventListResult {
        events = List.copyOf(events);
    }
}
