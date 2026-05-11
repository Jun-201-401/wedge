package com.wedge.evidence.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactContentWriter;
import com.wedge.evidence.domain.Artifact;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Component
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "s3")
public class S3ArtifactContentWriter implements ArtifactContentWriter {
    private final S3Client s3Client;
    private final String defaultBucket;

    public S3ArtifactContentWriter(
            S3Client s3Client,
            @Value("${wedge.artifacts.bucket:}") String defaultBucket
    ) {
        this.s3Client = s3Client;
        this.defaultBucket = defaultBucket;
    }

    @Override
    public void save(Artifact artifact, byte[] content) {
        String bucket = resolveBucket(artifact);
        String key = artifact.getS3Key();
        if (key == null || key.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact key is required.");
        }

        try {
            s3Client.putObject(
                    PutObjectRequest.builder()
                            .bucket(bucket)
                            .key(key)
                            .contentType(artifact.getMimeType())
                            .contentLength((long) content.length)
                            .build(),
                    RequestBody.fromBytes(content)
            );
        } catch (S3Exception | SdkClientException exception) {
            throw new BusinessException(
                    ErrorCode.INTERNAL_ERROR,
                    "Failed to write artifact content to S3.",
                    Map.of("bucket", bucket, "key", key),
                    exception
            );
        }
    }

    private String resolveBucket(Artifact artifact) {
        String bucket = artifact.getS3Bucket();
        if (bucket == null || bucket.isBlank()) {
            bucket = defaultBucket;
        }
        if (bucket == null || bucket.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact bucket is required.");
        }
        return bucket;
    }
}
