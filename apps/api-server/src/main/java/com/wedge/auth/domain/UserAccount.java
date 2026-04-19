package com.wedge.auth.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

public class UserAccount {
    private UUID id;
    private String authSubject;
    private String email;
    private String displayName;
    private String status;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private long version;

    public UserAccount() {
    }

    public UserAccount(UUID id, String authSubject, String email, String displayName, String status) {
        this.id = id;
        this.authSubject = authSubject;
        this.email = email;
        this.displayName = displayName;
        this.status = status;
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public String getAuthSubject() { return authSubject; }
    public void setAuthSubject(String authSubject) { this.authSubject = authSubject; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
    public long getVersion() { return version; }
    public void setVersion(long version) { this.version = version; }
}
