package com.wedge.scenarioauthoring.application;

import com.wedge.common.error.BusinessException;
import com.wedge.discovery.application.DiscoveryUrlValidator;
import com.wedge.run.application.ScenarioPlanValidator;
import java.net.URI;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ScenarioPlanCandidateValidator {
    private final ScenarioPlanValidator scenarioPlanValidator;
    private final DiscoveryUrlValidator discoveryUrlValidator;

    public Map<String, Object> validate(Map<String, Object> scenarioPlan, String startUrl, String devicePreset) {
        try {
            URI parsedStartUrl = URI.create(startUrl);
            discoveryUrlValidator.validate(parsedStartUrl);
            scenarioPlanValidator.validateScenarioPlan(scenarioPlan, parsedStartUrl, devicePreset);
            return Map.of(
                    "schema_valid", true,
                    "safety_valid", true,
                    "fit_requirements_valid", true,
                    "errors", List.of(),
                    "warnings", List.of()
            );
        } catch (BusinessException | IllegalArgumentException exception) {
            return Map.of(
                    "schema_valid", false,
                    "safety_valid", false,
                    "fit_requirements_valid", false,
                    "errors", List.of(Map.of(
                            "code", "scenario_plan_invalid",
                            "message", exception.getMessage(),
                            "path", "$.candidates[0].scenario_plan"
                    )),
                    "warnings", List.of()
            );
        }
    }
}
