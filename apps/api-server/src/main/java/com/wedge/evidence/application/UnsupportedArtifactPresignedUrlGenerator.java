package com.wedge.evidence.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.domain.Artifact;
import java.net.URL;
import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnMissingBean(ArtifactPresignedUrlGenerator.class)
public class UnsupportedArtifactPresignedUrlGenerator implements ArtifactPresignedUrlGenerator {
    @Override
    public URL generateGetUrl(Artifact artifact, Duration ttl) {
        throw new BusinessException(
                ErrorCode.ARTIFACT_PRESIGNED_URL_UNAVAILABLE,
                "Artifact presigned URLs require S3 artifact storage."
        );
    }
}
