package com.wedge.run.api.internal.runner.dto;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum RunnerAgentEventType {
    PRE_DECISION_VERIFIED,
    DECISION_MADE,
    POLICY_CHECKED,
    ACTION_COMPLETED,
    ACTION_FAILED,
    GOAL_VERIFIED,
    TRACE_PERSISTED;

    @JsonCreator
    public static RunnerAgentEventType from(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return RunnerAgentEventType.valueOf(value);
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }
}
