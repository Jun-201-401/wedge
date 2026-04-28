package com.wedge.auth.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class UserCredential {
    private UUID userId;
    private String passwordHash;
    private OffsetDateTime passwordUpdatedAt;
    private OffsetDateTime createdAt;

    public UserCredential(UUID userId, String passwordHash) {
        this.userId = userId;
        this.passwordHash = passwordHash;
    }
}
