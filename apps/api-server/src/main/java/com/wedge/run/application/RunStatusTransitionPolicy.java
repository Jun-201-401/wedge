package com.wedge.run.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.run.domain.RunStatus;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public final class RunStatusTransitionPolicy {

    private static final Map<RunStatus, Set<RunStatus>> ALLOWED_TRANSITIONS = new EnumMap<>(RunStatus.class);

    static {
        ALLOWED_TRANSITIONS.put(RunStatus.CREATED, EnumSet.of(RunStatus.QUEUED, RunStatus.FAILED));
        ALLOWED_TRANSITIONS.put(RunStatus.QUEUED, EnumSet.of(RunStatus.STARTING, RunStatus.RUNNING, RunStatus.FAILED, RunStatus.STOP_REQUESTED));
        ALLOWED_TRANSITIONS.put(RunStatus.STARTING, EnumSet.of(RunStatus.RUNNING, RunStatus.FAILED, RunStatus.STOP_REQUESTED));
        ALLOWED_TRANSITIONS.put(RunStatus.RUNNING, EnumSet.of(RunStatus.STOP_REQUESTED, RunStatus.COMPLETED, RunStatus.FAILED));
        ALLOWED_TRANSITIONS.put(RunStatus.STOP_REQUESTED, EnumSet.of(RunStatus.STOPPED, RunStatus.FAILED));
        ALLOWED_TRANSITIONS.put(RunStatus.STOPPED, EnumSet.noneOf(RunStatus.class));
        ALLOWED_TRANSITIONS.put(RunStatus.COMPLETED, EnumSet.noneOf(RunStatus.class));
        ALLOWED_TRANSITIONS.put(RunStatus.FAILED, EnumSet.noneOf(RunStatus.class));
    }

    private RunStatusTransitionPolicy() {
    }

    public static boolean canTransition(RunStatus from, RunStatus to) {
        if (from == null || to == null) {
            return false;
        }

        return ALLOWED_TRANSITIONS.getOrDefault(from, Set.of()).contains(to);
    }

    public static void validateTransition(RunStatus from, RunStatus to) {
        if (!canTransition(from, to)) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Invalid run status transition: " + from + " -> " + to);
        }
    }
}
