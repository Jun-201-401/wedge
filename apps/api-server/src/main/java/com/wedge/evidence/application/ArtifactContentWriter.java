package com.wedge.evidence.application;

import com.wedge.evidence.domain.Artifact;

public interface ArtifactContentWriter {
    void save(Artifact artifact, byte[] content);
}
