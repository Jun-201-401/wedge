package com.wedge.auth.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class UserAccount {
    private UUID id;
    private String authSubject;
    private String email;
    private String displayName;
    private String status;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private long version;

    public UserAccount(UUID id, String authSubject, String email, String displayName, String status) {
        this.id = id;
        this.authSubject = authSubject;
        this.email = email;
        this.displayName = displayName;
        this.status = status;
    }
}
