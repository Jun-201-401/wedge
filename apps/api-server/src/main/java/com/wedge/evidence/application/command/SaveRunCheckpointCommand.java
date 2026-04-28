package com.wedge.evidence.application.command;

import java.util.List;
import java.util.Map;

public record SaveRunCheckpointCommand(
        String checkpointKey,
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
