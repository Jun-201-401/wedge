package com.wedge.run.application;

import java.util.Map;
import java.util.Optional;

final class ScenarioPlanGoalResolver {
    private ScenarioPlanGoalResolver() {
    }

    static Optional<String> resolve(Map<String, Object> scenarioPlan) {
        if (scenarioPlan == null || scenarioPlan.isEmpty()) {
            return Optional.empty();
        }
        Object goal = scenarioPlan.get("goal");
        if (goal instanceof String text && !text.isBlank()) {
            return Optional.of(text);
        }
        return Optional.empty();
    }
}
