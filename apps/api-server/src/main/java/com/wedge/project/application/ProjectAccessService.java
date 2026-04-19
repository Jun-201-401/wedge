package com.wedge.project.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.project.infrastructure.ProjectAccessMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class ProjectAccessService {
    private final ProjectAccessMapper projectAccessMapper;

    public ProjectAccessService(ProjectAccessMapper projectAccessMapper) {
        this.projectAccessMapper = projectAccessMapper;
    }

    @Transactional(readOnly = true)
    public void ensureProjectAccessible(UUID projectId, UUID userId) {
        if (!projectAccessMapper.existsActiveProject(projectId)) {
            throw new BusinessException(ErrorCode.PROJECT_NOT_FOUND);
        }
        if (!projectAccessMapper.existsProjectMember(projectId, userId)) {
            throw new BusinessException(ErrorCode.FORBIDDEN);
        }
    }

    @Transactional(readOnly = true)
    public boolean isProjectMember(UUID projectId, UUID userId) {
        return projectAccessMapper.existsProjectMember(projectId, userId);
    }
}
