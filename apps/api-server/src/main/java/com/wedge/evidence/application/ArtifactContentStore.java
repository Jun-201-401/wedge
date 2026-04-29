package com.wedge.evidence.application;

import com.wedge.evidence.domain.Artifact;
import org.springframework.core.io.Resource;

public interface ArtifactContentStore {
    Resource load(Artifact artifact);
}
