package com.wedge.evidence.application;

import com.wedge.evidence.domain.Artifact;
import java.net.URL;
import java.time.Duration;

public interface ArtifactPresignedUrlGenerator {
    URL generateGetUrl(Artifact artifact, Duration ttl);
}
