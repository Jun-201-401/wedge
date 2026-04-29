package com.wedge.evidence.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

class S3ArtifactStorageConfigTest {
    private final S3ArtifactStorageConfig config = new S3ArtifactStorageConfig();

    @Test
    void artifactS3CredentialsProviderUsesDefaultProviderWhenExplicitCredentialsAreBlank() {
        AwsCredentialsProvider provider = config.artifactS3CredentialsProvider("", "");

        assertThat(provider).isNotInstanceOf(StaticCredentialsProvider.class);
    }

    @Test
    void artifactS3CredentialsProviderUsesStaticProviderWhenExplicitCredentialsAreComplete() {
        AwsCredentialsProvider provider = config.artifactS3CredentialsProvider("access-key", "secret-key");

        assertThat(provider).isInstanceOf(StaticCredentialsProvider.class);
    }

    @Test
    void artifactS3CredentialsProviderRejectsPartialCredentials() {
        assertThatThrownBy(() -> config.artifactS3CredentialsProvider("access-key", ""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be set together");

        assertThatThrownBy(() -> config.artifactS3CredentialsProvider("", "secret-key"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be set together");
    }
}
