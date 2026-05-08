package com.wedge.project.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.project.infrastructure.ProjectAccessMapper;
import java.net.URI;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DefaultProjectServiceTest {
    private static final UUID USER_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID WORKSPACE_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID PROJECT_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");

    @Mock
    private ProjectAccessMapper projectAccessMapper;

    @Test
    void resolveDefaultProjectReusesExistingProject() {
        when(projectAccessMapper.findDefaultProjectId(USER_ID)).thenReturn(Optional.of(PROJECT_ID));
        DefaultProjectService service = new DefaultProjectService(projectAccessMapper);

        UUID resolved = service.resolveDefaultProject(USER_ID, URI.create("https://example.com/pricing"));

        assertThat(resolved).isEqualTo(PROJECT_ID);
        verify(projectAccessMapper, never()).insertDefaultWorkspace(any(), any(), any(), any());
        verify(projectAccessMapper, never()).insertDefaultProject(any(), any(), any(), any(), any(), any());
        verify(projectAccessMapper).insertProjectMember(PROJECT_ID, USER_ID, "OWNER");
    }

    @Test
    void resolveDefaultProjectCreatesWorkspaceProjectAndMembershipOnce() {
        when(projectAccessMapper.findDefaultProjectId(USER_ID))
                .thenReturn(Optional.empty(), Optional.of(PROJECT_ID));
        when(projectAccessMapper.findDefaultWorkspaceId(USER_ID, "user-11111111-1111-4111-8111-111111111111"))
                .thenReturn(Optional.of(WORKSPACE_ID));
        DefaultProjectService service = new DefaultProjectService(projectAccessMapper);

        UUID resolved = service.resolveDefaultProject(USER_ID, URI.create("https://example.com:8443/pricing"));

        assertThat(resolved).isEqualTo(PROJECT_ID);
        verify(projectAccessMapper).insertDefaultWorkspace(
                any(UUID.class),
                eq(USER_ID),
                eq("Default Workspace"),
                eq("user-11111111-1111-4111-8111-111111111111")
        );
        verify(projectAccessMapper).insertWorkspaceMember(WORKSPACE_ID, USER_ID, "OWNER");
        verify(projectAccessMapper).insertDefaultProject(
                any(UUID.class),
                eq(WORKSPACE_ID),
                eq(USER_ID),
                eq("Default Project"),
                eq("default"),
                eq("https://example.com:8443")
        );
        verify(projectAccessMapper).insertProjectMember(PROJECT_ID, USER_ID, "OWNER");
    }
}
