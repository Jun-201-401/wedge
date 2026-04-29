package com.wedge.evidence.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.wedge.evidence.domain.Artifact;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

class S3ArtifactContentStoreMinioIntegrationTest {
    @Test
    void loadReadsArtifactContentFromMinioWhenE2eEnvironmentIsConfigured() throws Exception {
        String endpoint = System.getenv("WEDGE_MINIO_E2E_ENDPOINT");
        String accessKeyId = System.getenv("WEDGE_MINIO_E2E_ACCESS_KEY_ID");
        String secretAccessKey = System.getenv("WEDGE_MINIO_E2E_SECRET_ACCESS_KEY");
        String bucket = System.getenv("WEDGE_MINIO_E2E_BUCKET");
        assumeTrue(isPresent(endpoint) && isPresent(accessKeyId) && isPresent(secretAccessKey) && isPresent(bucket),
                "MinIO E2E environment is not configured");

        String key = "api-minio-e2e/" + UUID.randomUUID() + "/artifact.txt";
        byte[] expectedContent = ("api-minio-e2e-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);

        try (S3Client s3Client = S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKeyId, secretAccessKey)))
                .region(Region.of(System.getenv().getOrDefault("WEDGE_MINIO_E2E_REGION", "us-east-1")))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(true)
                        .build())
                .build()) {
            s3Client.putObject(PutObjectRequest.builder()
                            .bucket(bucket)
                            .key(key)
                            .contentType("text/plain")
                            .build(),
                    RequestBody.fromBytes(expectedContent));

            Artifact artifact = new Artifact();
            artifact.setS3Bucket(bucket);
            artifact.setS3Key(key);

            Resource resource = new S3ArtifactContentStore(s3Client, bucket).load(artifact);

            assertThat(resource.getInputStream().readAllBytes()).isEqualTo(expectedContent);

            s3Client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .build());
        }
    }

    private static boolean isPresent(String value) {
        return value != null && !value.isBlank();
    }
}
