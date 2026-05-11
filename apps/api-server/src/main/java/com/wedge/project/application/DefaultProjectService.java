package com.wedge.project.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.project.infrastructure.ProjectAccessMapper;
import java.net.URI;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DefaultProjectService {
    private static final String DEFAULT_PROJECT_KEY = "default";
    private static final String DEFAULT_PROJECT_NAME = "Default Project";
    private static final String DEFAULT_WORKSPACE_NAME = "Default Workspace";
    private static final String DEFAULT_OWNER_ROLE = "OWNER";

    private final ProjectAccessMapper projectAccessMapper;

    @Transactional
    public UUID resolveDefaultProject(UUID userId, URI inputUrl) {
        return projectAccessMapper.findDefaultProjectId(userId)
                .map(projectId -> ensureDefaultProjectMembership(projectId, userId))
                .orElseGet(() -> createAndFindDefaultProject(userId, inputUrl));
    }

    private UUID ensureDefaultProjectMembership(UUID projectId, UUID userId) {
        projectAccessMapper.insertProjectMember(projectId, userId, DEFAULT_OWNER_ROLE);
        return projectId;
    }

    private UUID createAndFindDefaultProject(UUID userId, URI inputUrl) {
        UUID workspaceId = UUID.randomUUID();
        String workspaceSlug = defaultWorkspaceSlug(userId);
        projectAccessMapper.insertDefaultWorkspace(workspaceId, userId, DEFAULT_WORKSPACE_NAME, workspaceSlug);
        UUID resolvedWorkspaceId = projectAccessMapper.findDefaultWorkspaceId(userId, workspaceSlug)
                .orElseThrow(() -> new BusinessException(ErrorCode.INTERNAL_ERROR, "Default workspace was not created."));
        projectAccessMapper.insertWorkspaceMember(resolvedWorkspaceId, userId, DEFAULT_OWNER_ROLE);

        UUID projectId = UUID.randomUUID();
        projectAccessMapper.insertDefaultProject(
                projectId,
                resolvedWorkspaceId,
                userId,
                DEFAULT_PROJECT_NAME,
                DEFAULT_PROJECT_KEY,
                origin(inputUrl)
        );
        UUID resolvedProjectId = projectAccessMapper.findDefaultProjectId(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.INTERNAL_ERROR, "Default project was not created."));
        projectAccessMapper.insertProjectMember(resolvedProjectId, userId, DEFAULT_OWNER_ROLE);
        return resolvedProjectId;
    }

    private String defaultWorkspaceSlug(UUID userId) {
        return "user-" + userId.toString().toLowerCase(Locale.ROOT);
    }

    private String origin(URI inputUrl) {
        StringBuilder builder = new StringBuilder()
                .append(inputUrl.getScheme().toLowerCase(Locale.ROOT))
                .append("://")
                .append(inputUrl.getHost().toLowerCase(Locale.ROOT));
        if (inputUrl.getPort() >= 0) {
            builder.append(':').append(inputUrl.getPort());
        }
        return builder.toString();
    }
}
