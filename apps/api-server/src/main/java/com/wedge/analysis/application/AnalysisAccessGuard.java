package com.wedge.analysis.application;

import com.wedge.project.application.ProjectAccessService;
import java.util.Arrays;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class AnalysisAccessGuard {
    private final ProjectAccessService projectAccessService;
    private final AnalysisProperties analysisProperties;
    private final Environment environment;

    public void ensureProjectAccessible(UUID projectId, UUID userId) {
        if (analysisProperties.isProjectAccessCheckEnabled() || !isDevProfileActive()) {
            projectAccessService.ensureProjectAccessible(projectId, userId);
        }
    }

    private boolean isDevProfileActive() {
        return Arrays.asList(environment.getActiveProfiles()).contains("dev");
    }
}
