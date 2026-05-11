package com.wedge.project.application;

import java.util.UUID;

public record ProjectBootstrapContext(
        UUID projectId,
        UUID scenarioTemplateVersionId
) {
}
