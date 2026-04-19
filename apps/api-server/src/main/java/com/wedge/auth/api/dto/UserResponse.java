package com.wedge.auth.api.dto;

import com.wedge.auth.domain.UserAccount;

import java.util.UUID;

public record UserResponse(
        UUID id,
        String email,
        String displayName,
        String status
) {
    public static UserResponse from(UserAccount user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getDisplayName(), user.getStatus());
    }
}
