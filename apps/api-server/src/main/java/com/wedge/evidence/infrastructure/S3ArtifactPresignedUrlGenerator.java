package com.wedge.evidence.infrastructure;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.ArtifactPresignedUrlGenerator;
import com.wedge.evidence.domain.Artifact;
import java.net.URL;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

@Component
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "s3")
public class S3ArtifactPresignedUrlGenerator implements ArtifactPresignedUrlGenerator {
    private final S3Presigner s3Presigner;
    private final String defaultBucket;

    public S3ArtifactPresignedUrlGenerator(
            S3Presigner s3Presigner,
            @Value("${wedge.artifacts.bucket:}") String defaultBucket
    ) {
        this.s3Presigner = s3Presigner;
        this.defaultBucket = defaultBucket;
    }

    @Override
    public URL generateGetUrl(Artifact artifact, Duration ttl) {
        String bucket = resolveBucket(artifact);
        String key = artifact.getS3Key();
        if (key == null || key.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Artifact key is required.");
        }

        GetObjectRequest getObjectRequest = GetObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build();
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(getObjectRequest)
                .build();
        return s3Presigner.presignGetObject(presignRequest).url();
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
