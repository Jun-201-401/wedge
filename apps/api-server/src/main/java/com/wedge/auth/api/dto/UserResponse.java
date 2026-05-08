package com.wedge.auth.api.dto;

import com.wedge.auth.domain.UserAccount;

import java.util.UUID;

public record UserResponse(
        UUID id,
        String email,
        String displayName,
        String status,
        UUID defaultProjectId,
        UUID defaultScenarioTemplateVersionId
) {
    public static UserResponse from(UserAccount user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getDisplayName(), user.getStatus(), null, null);
    }

    public static UserResponse from(UserAccount user, UUID defaultProjectId, UUID defaultScenarioTemplateVersionId) {
        return new UserResponse(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getStatus(),
                defaultProjectId,
                defaultScenarioTemplateVersionId
        );
    }
}
