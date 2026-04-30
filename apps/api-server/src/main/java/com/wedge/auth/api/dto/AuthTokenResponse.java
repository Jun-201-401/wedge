package com.wedge.auth.api.dto;

public record AuthTokenResponse(
        String accessToken,
        String tokenType,
        long expiresIn,
        UserResponse user
) {
}
