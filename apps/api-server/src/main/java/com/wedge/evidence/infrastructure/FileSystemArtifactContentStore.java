package com.wedge.evidence.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactContentStore;
import com.wedge.evidence.domain.Artifact;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "filesystem", matchIfMissing = true)
public class FileSystemArtifactContentStore implements ArtifactContentStore {
    private final Path artifactRoot;

    public FileSystemArtifactContentStore(
            @Value("${wedge.artifacts.local-root:../runner/.runner-artifacts}") String artifactRoot
    ) {
        this.artifactRoot = Path.of(artifactRoot).toAbsolutePath().normalize();
    }

    @Override
    public Resource load(Artifact artifact) {
        Path contentPath = resolveArtifactPath(artifact.getS3Key());
        Resource resource = new FileSystemResource(contentPath);
        if (!resource.exists() || !resource.isReadable()) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact content was not found.");
        }
        return resource;
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
}
