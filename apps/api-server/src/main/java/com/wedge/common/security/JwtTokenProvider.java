package com.wedge.common.security;

import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Date;
import java.util.UUID;

@Component
public class JwtTokenProvider {
    private static final String ACCESS_SUBJECT = "WedgeAccessToken";
    private static final String REFRESH_SUBJECT = "WedgeRefreshToken";
    private static final String CLAIM_USER_ID = "userId";
    private static final String CLAIM_EMAIL = "email";
    private static final String CLAIM_DISPLAY_NAME = "displayName";
    private static final String BEARER_PREFIX = "Bearer ";

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.access-expiration}")
    private long accessExpirationMillis;

    @Value("${jwt.refresh-expiration}")
    private long refreshExpirationMillis;

    private Algorithm algorithm;
    private JWTVerifier accessVerifier;
    private JWTVerifier refreshVerifier;

    @PostConstruct
    public void initialize() {
        validateSecret();
        algorithm = Algorithm.HMAC512(secret);
        accessVerifier = JWT.require(algorithm).withSubject(ACCESS_SUBJECT).build();
        refreshVerifier = JWT.require(algorithm).withSubject(REFRESH_SUBJECT).build();
    }

    private void validateSecret() {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("JWT_SECRET must be configured");
        }
        if (secret.length() < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 characters");
        }
    }

    public String createAccessToken(UUID userId, String email, String displayName) {
        Instant now = Instant.now();
        return JWT.create()
                .withSubject(ACCESS_SUBJECT)
                .withIssuedAt(Date.from(now))
                .withJWTId(UUID.randomUUID().toString())
                .withExpiresAt(Date.from(now.plusMillis(accessExpirationMillis)))
                .withClaim(CLAIM_USER_ID, userId.toString())
                .withClaim(CLAIM_EMAIL, email)
                .withClaim(CLAIM_DISPLAY_NAME, displayName)
                .sign(algorithm);
    }

    public String createRefreshToken(UUID userId, String email) {
        Instant now = Instant.now();
        return JWT.create()
                .withSubject(REFRESH_SUBJECT)
                .withIssuedAt(Date.from(now))
                .withJWTId(UUID.randomUUID().toString())
                .withExpiresAt(Date.from(now.plusMillis(refreshExpirationMillis)))
                .withClaim(CLAIM_USER_ID, userId.toString())
                .withClaim(CLAIM_EMAIL, email)
                .sign(algorithm);
    }

    public AccessTokenPayload parseAccessToken(String token) {
        DecodedJWT jwt = accessVerifier.verify(token);
        return new AccessTokenPayload(
                UUID.fromString(jwt.getClaim(CLAIM_USER_ID).asString()),
                jwt.getClaim(CLAIM_EMAIL).asString(),
                jwt.getClaim(CLAIM_DISPLAY_NAME).asString()
        );
    }

    public UUID getUserIdFromRefreshToken(String token) {
        DecodedJWT jwt = refreshVerifier.verify(token);
        return UUID.fromString(jwt.getClaim(CLAIM_USER_ID).asString());
    }

    public boolean validateRefreshToken(String token) {
        try {
            refreshVerifier.verify(token);
            return true;
        } catch (JWTVerificationException | IllegalArgumentException exception) {
            return false;
        }
    }

    public String extractBearerToken(String authorizationHeader) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            return null;
        }
        String value = authorizationHeader.trim();
        if (value.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            value = value.substring(BEARER_PREFIX.length()).trim();
        }
        return value.isBlank() ? null : value;
    }

    public long accessExpirationSeconds() {
        return accessExpirationMillis / 1000;
    }

    public long refreshExpirationMillis() {
        return refreshExpirationMillis;
    }

    public record AccessTokenPayload(UUID userId, String email, String displayName) {
    }
}
