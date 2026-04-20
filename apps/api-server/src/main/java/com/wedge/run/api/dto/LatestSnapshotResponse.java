package com.wedge.run.api.dto;

import java.net.URI;
import java.time.OffsetDateTime;
import java.util.UUID;

public record LatestSnapshotResponse(UUID artifactId, URI url, OffsetDateTime capturedAt) {
}
