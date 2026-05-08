package com.wedge.project.application;

import com.wedge.auth.domain.UserAccount;
import com.wedge.project.infrastructure.ProjectBootstrapMapper;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectBootstrapServiceTest {
    private static final String DEFAULT_TEMPLATE_KEY = "web-discovery-default";

    private final ProjectBootstrapMapper mapper = mock(ProjectBootstrapMapper.class);
    private final ProjectBootstrapService service = new ProjectBootstrapService(mapper);

    @Test
    void ensureDefaultContextReusesExistingAccessibleProjectAndTemplate() {
        UUID userId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID scenarioTemplateVersionId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "ACTIVE");
        when(mapper.findDefaultScenarioTemplateVersionId(DEFAULT_TEMPLATE_KEY)).thenReturn(Optional.of(scenarioTemplateVersionId));
        when(mapper.findFirstAccessibleProjectId(userId)).thenReturn(Optional.of(projectId));

        ProjectBootstrapContext context = service.ensureDefaultContext(user);

        assertThat(context.projectId()).isEqualTo(projectId);
        assertThat(context.scenarioTemplateVersionId()).isEqualTo(scenarioTemplateVersionId);
        verify(mapper, never()).upsertProject(any(), any(), any(), any(), any(), any(), any());
        verify(mapper, never()).upsertScenarioTemplate(any(), any(), any(), any(), any(), any());
    }

    @Test
    void ensureDefaultContextCreatesPersonalProjectWhenUserHasNoProject() {
        UUID userId = UUID.randomUUID();
        UUID scenarioTemplateVersionId = UUID.randomUUID();
        UserAccount user = new UserAccount(userId, "local:user@example.com", "user@example.com", "User", "ACTIVE");
        when(mapper.findDefaultScenarioTemplateVersionId(DEFAULT_TEMPLATE_KEY)).thenReturn(Optional.of(scenarioTemplateVersionId));
        when(mapper.findFirstAccessibleProjectId(userId)).thenReturn(Optional.empty());

        ProjectBootstrapContext context = service.ensureDefaultContext(user);

        assertThat(context.projectId()).isNotNull();
        assertThat(context.scenarioTemplateVersionId()).isEqualTo(scenarioTemplateVersionId);
        verify(mapper).upsertWorkspace(any(), eq("User Workspace"), eq("user-" + userId), eq(userId));
        verify(mapper).upsertWorkspaceMember(any(), eq(userId), eq("OWNER"), eq("ACTIVE"));
        verify(mapper).upsertProject(eq(context.projectId()), any(), eq("User Project"), eq("default"), eq("https://example.com/"), any(), eq(userId));
        verify(mapper).upsertProjectMember(eq(context.projectId()), eq(userId), eq("OWNER"));
    }
}
