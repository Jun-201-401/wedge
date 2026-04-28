package com.wedge.evidence.application;

import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.application.command.SaveRunArtifactCommand;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ArtifactPersistenceService {
    private final ArtifactMapper artifactMapper;

    public int saveRunArtifacts(UUID runId, SaveRunArtifactsCommand command) {
        return saveRunArtifacts(runId, command, Map.of());
    }

    public int saveRunArtifacts(UUID runId, SaveRunArtifactsCommand command, Map<String, UUID> stepIdsByKey) {
        command.artifacts().forEach(artifact -> saveIfAbsent(runId, artifact, stepIdsByKey.get(artifact.stepKey())));
        return command.artifacts().size();
    }

    private void saveIfAbsent(UUID runId, SaveRunArtifactCommand request, UUID stepId) {
        if (artifactMapper.findById(request.artifactId()).isPresent()) {
            return;
        }

        artifactMapper.insert(toArtifact(runId, request, stepId));
    }

    private Artifact toArtifact(UUID runId, SaveRunArtifactCommand request, UUID stepId) {
        Artifact artifact = new Artifact();
        artifact.setId(request.artifactId());
        artifact.setRunId(runId);
        artifact.setStepId(stepId);
        artifact.setArtifactType(request.artifactType());
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
