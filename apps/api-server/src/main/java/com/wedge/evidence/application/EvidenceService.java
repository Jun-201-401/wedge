package com.wedge.evidence.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EvidenceService {
    private final RunService runService;
    private final ArtifactMapper artifactMapper;
    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final EvidencePacketAssembler evidencePacketAssembler;
    private final Path artifactRoot;

    public EvidenceService(
            RunService runService,
            ArtifactMapper artifactMapper,
            CheckpointMapper checkpointMapper,
            ObservationMapper observationMapper,
            EvidencePacketAssembler evidencePacketAssembler,
            @Value("${wedge.artifacts.local-root:../runner/.runner-artifacts}") String artifactRoot
    ) {
        this.runService = runService;
        this.artifactMapper = artifactMapper;
        this.checkpointMapper = checkpointMapper;
        this.observationMapper = observationMapper;
        this.evidencePacketAssembler = evidencePacketAssembler;
        this.artifactRoot = Path.of(artifactRoot).toAbsolutePath().normalize();
    }

    @Transactional(readOnly = true)
    public List<ArtifactResponse> listRunArtifacts(UUID runId) {
        runService.getRun(runId);
        return artifactMapper.findByRunId(runId).stream()
                .map(ArtifactResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getRunEvidencePacket(UUID runId) {
        RunResponse run = runService.getRun(runId);
        return evidencePacketAssembler.assemble(
                run,
                artifactMapper.findByRunId(runId),
                checkpointMapper.findByRunId(runId),
                observationMapper.findByRunId(runId)
        );
    }

    @Transactional(readOnly = true)
    public ArtifactContent getRunArtifactContent(UUID runId, UUID artifactId) {
        runService.getRun(runId);
        Artifact artifact = artifactMapper.findByRunIdAndId(runId, artifactId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact was not found."));
        Path contentPath = resolveArtifactPath(artifact.getS3Key());
        Resource resource = new FileSystemResource(contentPath);
        if (!resource.exists() || !resource.isReadable()) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact content was not found.");
        }
        return new ArtifactContent(resource, artifact.getMimeType());
    }

    private Path resolveArtifactPath(String key) {
        if (key == null || key.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact key is required.");
        }
        Path resolved = artifactRoot.resolve(key).normalize();
        if (!resolved.startsWith(artifactRoot)) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "Artifact key escapes artifact root.");
        }
        return resolved;
    }

    public record ArtifactContent(Resource resource, String mimeType) {
    }
}
