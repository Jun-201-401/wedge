package com.wedge.evidence.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.domain.Artifact;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.Resource;

class FileSystemArtifactContentStoreTest {
    @TempDir
    private Path artifactRoot;

    @Test
    void loadReturnsReadableResourceInsideArtifactRoot() throws Exception {
        Path artifactPath = artifactRoot.resolve("runs/run-1/step-1/artifact.txt");
        Files.createDirectories(artifactPath.getParent());
        Files.writeString(artifactPath, "artifact");
        Artifact artifact = artifact("runs/run-1/step-1/artifact.txt");
        FileSystemArtifactContentStore store = new FileSystemArtifactContentStore(artifactRoot.toString());

        Resource resource = store.load(artifact);

        assertThat(resource.exists()).isTrue();
        assertThat(Files.readString(resource.getFile().toPath())).isEqualTo("artifact");
    }

    @Test
    void loadRejectsKeyEscapingArtifactRoot() {
        Artifact artifact = artifact("../secret.txt");
        FileSystemArtifactContentStore store = new FileSystemArtifactContentStore(artifactRoot.toString());

        assertThatThrownBy(() -> store.load(artifact))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    private Artifact artifact(String key) {
        Artifact artifact = new Artifact();
        artifact.setS3Key(key);
        return artifact;
    }
}
