package com.wedge.run.api.internal.runner.dto;

public enum RunnerAgentEventType {
    PRE_DECISION_VERIFIED,
    DECISION_MADE,
    POLICY_CHECKED,
    ACTION_COMPLETED,
    ACTION_FAILED,
    GOAL_VERIFIED,
    TRACE_PERSISTED
}
