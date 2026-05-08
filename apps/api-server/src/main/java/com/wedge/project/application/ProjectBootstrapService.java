package com.wedge.project.application;

import com.wedge.auth.domain.UserAccount;
import com.wedge.project.infrastructure.ProjectBootstrapMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProjectBootstrapService {
    private static final UUID DEFAULT_SCENARIO_TEMPLATE_ID = UUID.fromString("7d1cb11c-e47b-4bde-96bf-889828a5b1d4");
    private static final UUID DEFAULT_SCENARIO_TEMPLATE_VERSION_ID = UUID.fromString("2a4b1ed4-7820-4c97-8b7a-4ce4dce641c2");
    private static final String DEFAULT_SCENARIO_TEMPLATE_KEY = "web-discovery-default";
    private static final String DEFAULT_PROJECT_BASE_URL = "https://example.com/";
    private static final String OWNER = "OWNER";
    private static final String ACTIVE = "ACTIVE";

    private final ProjectBootstrapMapper projectBootstrapMapper;

    public ProjectBootstrapContext ensureDefaultContext(UserAccount user) {
        UUID scenarioTemplateVersionId = ensureDefaultScenarioTemplateVersion();
        UUID projectId = projectBootstrapMapper.findFirstAccessibleProjectId(user.getId())
                .orElseGet(() -> createPersonalProject(user));
        return new ProjectBootstrapContext(projectId, scenarioTemplateVersionId);
    }

    private UUID createPersonalProject(UserAccount user) {
        UUID workspaceId = deterministicUuid("workspace:" + user.getId());
        UUID projectId = deterministicUuid("project:" + user.getId());
        String safeName = user.getDisplayName() == null || user.getDisplayName().isBlank() ? "My" : user.getDisplayName().trim();

        projectBootstrapMapper.upsertWorkspace(
                workspaceId,
                safeName + " Workspace",
                "user-" + user.getId(),
                user.getId()
        );
        projectBootstrapMapper.upsertWorkspaceMember(workspaceId, user.getId(), OWNER, ACTIVE);
        projectBootstrapMapper.upsertProject(
                projectId,
                workspaceId,
                safeName + " Project",
                "default",
                DEFAULT_PROJECT_BASE_URL,
                "Personal project created automatically for web-based analysis.",
                user.getId()
        );
        projectBootstrapMapper.upsertProjectMember(projectId, user.getId(), OWNER);
        return projectId;
    }

    private UUID deterministicUuid(String value) {
        return UUID.nameUUIDFromBytes(value.getBytes(StandardCharsets.UTF_8));
    }

    private UUID ensureDefaultScenarioTemplateVersion() {
        return projectBootstrapMapper.findDefaultScenarioTemplateVersionId(DEFAULT_SCENARIO_TEMPLATE_KEY)
                .orElseGet(this::createDefaultScenarioTemplateVersion);
    }

    private UUID createDefaultScenarioTemplateVersion() {
        projectBootstrapMapper.upsertScenarioTemplate(
                DEFAULT_SCENARIO_TEMPLATE_ID,
                DEFAULT_SCENARIO_TEMPLATE_KEY,
                "Web Discovery Default",
                "Default scenario template version used by web-created analysis flows.",
                "conversion",
                ACTIVE
        );
        projectBootstrapMapper.upsertScenarioTemplateVersion(
                DEFAULT_SCENARIO_TEMPLATE_VERSION_ID,
                DEFAULT_SCENARIO_TEMPLATE_ID,
                "web-0.5",
                "0.5",
                defaultScenarioDefinitionJson(),
                true
        );
        return projectBootstrapMapper.findDefaultScenarioTemplateVersionId(DEFAULT_SCENARIO_TEMPLATE_KEY)
                .orElse(DEFAULT_SCENARIO_TEMPLATE_VERSION_ID);
    }

    private String defaultScenarioDefinitionJson() {
        return """
                {
                  "schema_version": "0.5",
                  "template_key": "web-discovery-default",
                  "name": "Web Discovery Default",
                  "goal": "Inspect the submitted URL and continue with the selected discovery recommendation.",
                  "default_device_preset": "desktop",
                  "safety": {
                    "stop_before_submit": true,
                    "requires_user_confirmation_for_submit": true
                  },
                  "steps": []
                }
                """;
    }
}
