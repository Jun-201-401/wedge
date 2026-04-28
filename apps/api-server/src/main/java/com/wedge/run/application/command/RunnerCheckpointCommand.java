package com.wedge.run.application.command;

import java.util.List;
import java.util.Map;

public record RunnerCheckpointCommand(
        String checkpointId,
        String stepKey,
        String stage,
        Map<String, Object> trigger,
        Map<String, Object> settle,
        int durationMs,
        Map<String, Object> state,
        List<Map<String, Object>> observations,
        List<Map<String, Object>> deltas,
        List<String> artifactRefs
) {
}
