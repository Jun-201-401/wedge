package com.wedge.auth.application;

import com.wedge.auth.api.dto.AuthTokenResponse;

public record AuthTokenIssue(
        AuthTokenResponse response,
        String refreshToken,
        long refreshExpiresInSeconds
) {
}
