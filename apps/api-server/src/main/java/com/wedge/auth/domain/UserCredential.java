package com.wedge.auth.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

public class UserCredential {
    private UUID userId;
    private String passwordHash;
    private OffsetDateTime passwordUpdatedAt;
    private OffsetDateTime createdAt;

    public UserCredential() {
    }

    public UserCredential(UUID userId, String passwordHash) {
        this.userId = userId;
        this.passwordHash = passwordHash;
    }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public OffsetDateTime getPasswordUpdatedAt() { return passwordUpdatedAt; }
    public void setPasswordUpdatedAt(OffsetDateTime passwordUpdatedAt) { this.passwordUpdatedAt = passwordUpdatedAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
}
