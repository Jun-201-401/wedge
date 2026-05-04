package com.wedge.evidence.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactContentStore;
import com.wedge.evidence.domain.Artifact;
import java.nio.file.Path;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "filesystem", matchIfMissing = true)
public class FileSystemArtifactContentStore implements ArtifactContentStore {
    private static final String DEFAULT_ARTIFACT_ROOT = "../runner/.runner-artifacts";

    private final List<Path> artifactRoots;

    public FileSystemArtifactContentStore(
            @Value("${wedge.artifacts.local-root:../runner/.runner-artifacts}") String artifactRoot
    ) {
        Path userDir = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path configuredRoot = resolveRoot(userDir, artifactRoot);
        this.artifactRoots = isDefaultArtifactRoot(artifactRoot)
                ? defaultArtifactRoots(userDir, configuredRoot)
                : List.of(configuredRoot);
    }

    @Override
    public Resource load(Artifact artifact) {
        String key = artifact.getS3Key();
        if (key == null || key.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact key is required.");
        }

        for (Path root : artifactRoots) {
            Path contentPath = resolveArtifactPath(root, key);
            Resource resource = new FileSystemResource(contentPath);
            if (resource.exists() && resource.isReadable()) {
                return resource;
            }
        }

        throw new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact content was not found.");
    }

    private Path resolveRoot(Path userDir, String artifactRoot) {
        Path root = Path.of(artifactRoot);
        return root.isAbsolute() ? root.normalize() : userDir.resolve(root).normalize();
    }

    private boolean isDefaultArtifactRoot(String artifactRoot) {
        return DEFAULT_ARTIFACT_ROOT.equals(artifactRoot);
    }

    private List<Path> defaultArtifactRoots(Path userDir, Path configuredRoot) {
        // Local IDE runs can start from the repo root while runner writes under apps/runner.
        Path repoRootRunnerRoot = userDir.resolve("apps/runner/.runner-artifacts").normalize();
        return List.of(configuredRoot, repoRootRunnerRoot).stream().distinct().toList();
    }

    private Path resolveArtifactPath(Path artifactRoot, String key) {
        Path resolved = artifactRoot.resolve(key).normalize();
        if (!resolved.startsWith(artifactRoot)) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "Artifact key escapes artifact root.");
        }
        return resolved;
    }
}
