package com.wedge.project.infrastructure;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Optional;
import java.util.UUID;

@Mapper
public interface ProjectBootstrapMapper {
    Optional<UUID> findFirstAccessibleProjectId(@Param("userId") UUID userId);

    Optional<UUID> findDefaultScenarioTemplateVersionId(@Param("templateKey") String templateKey);

    void upsertWorkspace(
            @Param("workspaceId") UUID workspaceId,
            @Param("name") String name,
            @Param("slug") String slug,
            @Param("createdBy") UUID createdBy
    );

    void upsertWorkspaceMember(
            @Param("workspaceId") UUID workspaceId,
            @Param("userId") UUID userId,
            @Param("role") String role,
            @Param("status") String status
    );

    void upsertProject(
            @Param("projectId") UUID projectId,
            @Param("workspaceId") UUID workspaceId,
            @Param("name") String name,
            @Param("projectKey") String projectKey,
            @Param("baseUrl") String baseUrl,
            @Param("description") String description,
            @Param("createdBy") UUID createdBy
    );

    void upsertProjectMember(
            @Param("projectId") UUID projectId,
            @Param("userId") UUID userId,
            @Param("role") String role
    );

    void upsertScenarioTemplate(
            @Param("templateId") UUID templateId,
            @Param("templateKey") String templateKey,
            @Param("name") String name,
            @Param("description") String description,
            @Param("category") String category,
            @Param("status") String status
    );

    void upsertScenarioTemplateVersion(
            @Param("versionId") UUID versionId,
            @Param("templateId") UUID templateId,
            @Param("versionLabel") String versionLabel,
            @Param("schemaVersion") String schemaVersion,
            @Param("definitionJsonb") String definitionJsonb,
            @Param("isDefault") boolean isDefault
    );
}
