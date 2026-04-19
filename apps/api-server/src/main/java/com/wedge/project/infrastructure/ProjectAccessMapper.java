package com.wedge.project.infrastructure;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.UUID;

@Mapper
public interface ProjectAccessMapper {
    boolean existsActiveProject(@Param("projectId") UUID projectId);
    boolean existsProjectMember(@Param("projectId") UUID projectId, @Param("userId") UUID userId);
}
