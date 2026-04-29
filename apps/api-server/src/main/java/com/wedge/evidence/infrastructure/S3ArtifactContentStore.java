package com.wedge.evidence.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactContentStore;
import com.wedge.evidence.domain.Artifact;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Component
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "s3")
public class S3ArtifactContentStore implements ArtifactContentStore {
    private final S3Client s3Client;
    private final String defaultBucket;

    public S3ArtifactContentStore(
            S3Client s3Client,
            @Value("${wedge.artifacts.bucket:}") String defaultBucket
    ) {
        this.s3Client = s3Client;
        this.defaultBucket = defaultBucket;
    }

    @Override
    public Resource load(Artifact artifact) {
        String bucket = resolveBucket(artifact);
        String key = artifact.getS3Key();
        if (key == null || key.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact key is required.");
        }

        try {
            ResponseBytes<GetObjectResponse> objectBytes = s3Client.getObjectAsBytes(
                    GetObjectRequest.builder()
                            .bucket(bucket)
                            .key(key)
                            .build()
            );
            byte[] content = objectBytes.asByteArray();
            return new ByteArrayResource(content) {
                @Override
                public String getFilename() {
                    return key;
                }
            };
        } catch (NoSuchKeyException exception) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact content was not found.", null, exception);
        } catch (S3Exception | SdkClientException exception) {
            throw new BusinessException(
                    ErrorCode.INTERNAL_ERROR,
                    "Failed to load artifact content from S3.",
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
