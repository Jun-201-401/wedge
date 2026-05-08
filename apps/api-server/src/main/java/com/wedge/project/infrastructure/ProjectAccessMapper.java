package com.wedge.project.infrastructure;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Optional;
import java.util.UUID;

@Mapper
public interface ProjectAccessMapper {
    boolean existsActiveProject(@Param("projectId") UUID projectId);
    boolean existsProjectMember(@Param("projectId") UUID projectId, @Param("userId") UUID userId);

    Optional<UUID> findDefaultProjectId(@Param("userId") UUID userId);
    Optional<UUID> findDefaultWorkspaceId(@Param("userId") UUID userId, @Param("slug") String slug);

    int insertDefaultWorkspace(
            @Param("workspaceId") UUID workspaceId,
            @Param("userId") UUID userId,
            @Param("name") String name,
            @Param("slug") String slug
    );

    int insertWorkspaceMember(
            @Param("workspaceId") UUID workspaceId,
            @Param("userId") UUID userId,
            @Param("role") String role
    );

    int insertDefaultProject(
            @Param("projectId") UUID projectId,
            @Param("workspaceId") UUID workspaceId,
            @Param("userId") UUID userId,
            @Param("name") String name,
            @Param("projectKey") String projectKey,
            @Param("baseUrl") String baseUrl
    );

    int insertProjectMember(
            @Param("projectId") UUID projectId,
            @Param("userId") UUID userId,
            @Param("role") String role
    );
}
