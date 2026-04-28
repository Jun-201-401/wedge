package com.wedge.run.api.internal.runner.dto;

public enum RunnerStepEventType {
    STEP_STARTED,
    ACTION_EXECUTED,
    STEP_COMPLETED,
    CONSOLE_ERROR,
    NETWORK_ERROR,
    ISSUE_SIGNAL_DETECTED
}
