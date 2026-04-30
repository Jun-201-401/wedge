package com.wedge.report.application;

import com.wedge.project.application.ProjectAccessService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ReportAccessGuard {
    private final ProjectAccessService projectAccessService;
    private final ReportProperties reportProperties;

    public void ensureProjectAccessible(UUID projectId, UUID userId) {
        if (reportProperties.isProjectAccessCheckEnabled()) {
            projectAccessService.ensureProjectAccessible(projectId, userId);
        }
    }
}
