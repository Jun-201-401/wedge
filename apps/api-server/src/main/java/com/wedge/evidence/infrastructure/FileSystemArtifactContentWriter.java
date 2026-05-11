package com.wedge.evidence.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactContentWriter;
import com.wedge.evidence.domain.Artifact;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "filesystem", matchIfMissing = true)
public class FileSystemArtifactContentWriter implements ArtifactContentWriter {
    private final Path artifactRoot;

    public FileSystemArtifactContentWriter(
            @Value("${wedge.artifacts.local-root:../runner/.runner-artifacts}") String artifactRoot
    ) {
        Path userDir = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path configuredRoot = Path.of(artifactRoot);
        this.artifactRoot = configuredRoot.isAbsolute()
                ? configuredRoot.normalize()
                : userDir.resolve(configuredRoot).normalize();
    }

    @Override
    public void save(Artifact artifact, byte[] content) {
        String key = artifact.getS3Key();
        if (key == null || key.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact key is required.");
        }

        Path contentPath = artifactRoot.resolve(key).normalize();
        if (!contentPath.startsWith(artifactRoot)) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "Artifact key escapes artifact root.");
        }

        try {
            Files.createDirectories(contentPath.getParent());
            Files.write(contentPath, content);
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to write artifact content.", null, exception);
        }
    }
}
