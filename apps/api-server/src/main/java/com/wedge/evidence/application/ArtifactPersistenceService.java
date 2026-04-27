package com.wedge.evidence.application;

import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.internal.runner.dto.RunnerArtifactRequest;
import com.wedge.internal.runner.dto.RunnerArtifactsRequest;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ArtifactPersistenceService {
    private final ArtifactMapper artifactMapper;

    public ArtifactPersistenceService(ArtifactMapper artifactMapper) {
        this.artifactMapper = artifactMapper;
    }

    public int saveRunArtifacts(UUID runId, RunnerArtifactsRequest request) {
        request.artifacts().forEach(artifact -> saveIfAbsent(runId, artifact));
        return request.artifacts().size();
    }

    private void saveIfAbsent(UUID runId, RunnerArtifactRequest request) {
        if (artifactMapper.findById(request.artifactId()).isPresent()) {
            return;
        }

        artifactMapper.insert(toArtifact(runId, request));
    }

    private Artifact toArtifact(UUID runId, RunnerArtifactRequest request) {
        Artifact artifact = new Artifact();
        artifact.setId(request.artifactId());
        artifact.setRunId(runId);
        artifact.setArtifactType(ArtifactType.valueOf(request.artifactType().name()));
        artifact.setS3Bucket(request.bucket());
        artifact.setS3Key(request.key());
        artifact.setMimeType(request.mimeType());
        artifact.setWidth(request.width());
        artifact.setHeight(request.height());
        artifact.setSizeBytes(request.sizeBytes());
        artifact.setSha256(request.sha256());
        artifact.setCapturedAt(request.createdAt());
        return artifact;
    }
}
