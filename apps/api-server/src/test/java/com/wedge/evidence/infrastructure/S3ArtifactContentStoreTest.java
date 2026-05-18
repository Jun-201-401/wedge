package com.wedge.evidence.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.domain.Artifact;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.Resource;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;

@ExtendWith(MockitoExtension.class)
class S3ArtifactContentStoreTest {
    @Mock
    private S3Client s3Client;

    @Test
    void loadGetsObjectFromArtifactBucketAndKey() throws Exception {
        Artifact artifact = artifact("wedge-artifacts-prod", "runs/run-1/step-1/artifact.txt");
        when(s3Client.getObject(any(GetObjectRequest.class))).thenReturn(responseStream("artifact"));
        S3ArtifactContentStore store = new S3ArtifactContentStore(s3Client, "");

        Resource resource = store.load(artifact);

        assertThat(resource.getInputStream().readAllBytes()).isEqualTo("artifact".getBytes(StandardCharsets.UTF_8));
        ArgumentCaptor<GetObjectRequest> requestCaptor = ArgumentCaptor.forClass(GetObjectRequest.class);
        verify(s3Client).getObject(requestCaptor.capture());
        assertThat(requestCaptor.getValue().bucket()).isEqualTo("wedge-artifacts-prod");
        assertThat(requestCaptor.getValue().key()).isEqualTo("runs/run-1/step-1/artifact.txt");
    }

    @Test
    void loadFallsBackToConfiguredBucketWhenArtifactBucketIsBlank() {
        Artifact artifact = artifact(null, "runs/run-1/step-1/artifact.txt");
        when(s3Client.getObject(any(GetObjectRequest.class))).thenReturn(responseStream("artifact"));
        S3ArtifactContentStore store = new S3ArtifactContentStore(s3Client, "wedge-artifacts-prod");

        store.load(artifact);

        ArgumentCaptor<GetObjectRequest> requestCaptor = ArgumentCaptor.forClass(GetObjectRequest.class);
        verify(s3Client).getObject(requestCaptor.capture());
        assertThat(requestCaptor.getValue().bucket()).isEqualTo("wedge-artifacts-prod");
    }

    @Test
    void loadMapsMissingS3ObjectToNotFound() {
        Artifact artifact = artifact("wedge-artifacts-prod", "runs/run-1/missing.txt");
        when(s3Client.getObject(any(GetObjectRequest.class))).thenThrow(NoSuchKeyException.builder().build());
        S3ArtifactContentStore store = new S3ArtifactContentStore(s3Client, "");

        assertThatThrownBy(() -> store.load(artifact))
                .isInstanceOfSatisfying(BusinessException.class, exception ->
                        assertThat(exception.errorCode()).isEqualTo(ErrorCode.RUN_NOT_FOUND));
    }

    private ResponseInputStream<GetObjectResponse> responseStream(String content) {
        return new ResponseInputStream<>(
                GetObjectResponse.builder().build(),
                AbortableInputStream.create(new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)))
        );
    }

    private Artifact artifact(String bucket, String key) {
        Artifact artifact = new Artifact();
        artifact.setS3Bucket(bucket);
        artifact.setS3Key(key);
        return artifact;
    }
}
