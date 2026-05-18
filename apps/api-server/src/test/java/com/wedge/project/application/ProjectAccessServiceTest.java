package com.wedge.project.application;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.project.infrastructure.ProjectAccessMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ProjectAccessServiceTest {
    private final ProjectAccessMapper projectAccessMapper = org.mockito.Mockito.mock(ProjectAccessMapper.class);
    private final ProjectAccessService projectAccessService = new ProjectAccessService(projectAccessMapper);

    @Test
    void ensureProjectAccessibleRejectsMissingOrInactiveProjectBeforeMembershipCheck() {
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(projectAccessMapper.existsActiveProject(projectId)).thenReturn(false);

        assertThatThrownBy(() -> projectAccessService.ensureProjectAccessible(projectId, userId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.PROJECT_NOT_FOUND);

        verify(projectAccessMapper, never()).existsProjectMember(projectId, userId);
    }

    @Test
    void ensureProjectAccessibleRejectsNonMember() {
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(projectAccessMapper.existsActiveProject(projectId)).thenReturn(true);
        when(projectAccessMapper.existsProjectMember(projectId, userId)).thenReturn(false);

        assertThatThrownBy(() -> projectAccessService.ensureProjectAccessible(projectId, userId))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.FORBIDDEN);
    }

    @Test
    void ensureProjectAccessibleAllowsActiveProjectMember() {
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(projectAccessMapper.existsActiveProject(projectId)).thenReturn(true);
        when(projectAccessMapper.existsProjectMember(projectId, userId)).thenReturn(true);

        projectAccessService.ensureProjectAccessible(projectId, userId);
    }
}

