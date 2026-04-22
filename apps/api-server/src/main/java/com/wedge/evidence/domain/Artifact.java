package com.wedge.evidence.domain;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
public class Artifact {
    private UUID id;
    private UUID runId;
    private UUID stepId;
    private ArtifactType artifactType;
    private String s3Bucket;
    private String s3Key;
    private String publicUrl;
    private String mimeType;
    private Integer width;
    private Integer height;
    private long sizeBytes;
    private String sha256;
    private OffsetDateTime capturedAt;
    private OffsetDateTime createdAt;
}
