package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import java.net.URL;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EvidencePacketSignedUrlDecoratorTest {
    @Mock
    private ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator;

    @Test
    void decorateRunPacketAddsFreshSignedUrlForReferencedScreenshotImageArtifact() throws Exception {
        UUID artifactId = UUID.randomUUID();
        Artifact screenshot = artifact(artifactId, ArtifactType.SCREENSHOT, "image/png");
        URL signedUrl = new URL("https://wedge-artifacts.s3.ap-northeast-2.amazonaws.com/runs/a.png?X-Amz-Signature=test");
        when(artifactPresignedUrlGenerator.generateGetUrl(screenshot, Duration.ofSeconds(3600))).thenReturn(signedUrl);

        Map<String, Object> decorated = newDecorator(20).decorateRunPacket(
                packet(List.of("artifact:" + artifactId), artifactId),
                List.of(screenshot)
        );

        assertThat(firstArtifact(decorated)).containsEntry("signed_url", signedUrl.toString());
    }

    @Test
    void decorateRunPacketDoesNotSignUnreferencedArtifacts() {
        UUID referencedArtifactId = UUID.randomUUID();
        UUID unreferencedArtifactId = UUID.randomUUID();
        Artifact screenshot = artifact(unreferencedArtifactId, ArtifactType.SCREENSHOT, "image/png");

        Map<String, Object> decorated = newDecorator(20).decorateRunPacket(
                packet(List.of("artifact:" + referencedArtifactId), unreferencedArtifactId),
                List.of(screenshot)
        );

        assertThat(firstArtifact(decorated)).doesNotContainKey("signed_url");
        verify(artifactPresignedUrlGenerator, never()).generateGetUrl(any(), any());
    }

    @Test
    void decorateRunPacketDoesNotSignMoreThanConfiguredMaxCount() throws Exception {
        UUID firstArtifactId = UUID.randomUUID();
        UUID secondArtifactId = UUID.randomUUID();
        Artifact firstScreenshot = artifact(firstArtifactId, ArtifactType.SCREENSHOT, "image/png");
        Artifact secondScreenshot = artifact(secondArtifactId, ArtifactType.SCREENSHOT, "image/png");
        when(artifactPresignedUrlGenerator.generateGetUrl(firstScreenshot, Duration.ofSeconds(3600)))
                .thenReturn(new URL("https://example.com/first.png?X-Amz-Signature=test"));

        Map<String, Object> decorated = newDecorator(1).decorateRunPacket(
                packet(List.of("artifact:" + firstArtifactId, "artifact:" + secondArtifactId), firstArtifactId, secondArtifactId),
                List.of(firstScreenshot, secondScreenshot)
        );

        List<Map<String, Object>> artifacts = artifacts(decorated);
        assertThat(artifacts.get(0)).containsKey("signed_url");
        assertThat(artifacts.get(1)).doesNotContainKey("signed_url");
        verify(artifactPresignedUrlGenerator, never()).generateGetUrl(secondScreenshot, Duration.ofSeconds(3600));
    }

    @Test
    void decorateRunPacketDoesNotAttemptMoreThanConfiguredMaxCountWhenPresignFails() {
        UUID firstArtifactId = UUID.randomUUID();
        UUID secondArtifactId = UUID.randomUUID();
        Artifact firstScreenshot = artifact(firstArtifactId, ArtifactType.SCREENSHOT, "image/png");
        Artifact secondScreenshot = artifact(secondArtifactId, ArtifactType.SCREENSHOT, "image/png");
        when(artifactPresignedUrlGenerator.generateGetUrl(firstScreenshot, Duration.ofSeconds(3600)))
                .thenThrow(new RuntimeException("presign unavailable"));

        Map<String, Object> decorated = newDecorator(1).decorateRunPacket(
                packet(List.of("artifact:" + firstArtifactId, "artifact:" + secondArtifactId), firstArtifactId, secondArtifactId),
                List.of(firstScreenshot, secondScreenshot)
        );

        assertThat(artifacts(decorated)).allSatisfy(artifact -> assertThat(artifact).doesNotContainKey("signed_url"));
        verify(artifactPresignedUrlGenerator, never()).generateGetUrl(secondScreenshot, Duration.ofSeconds(3600));
    }

    @Test
    void decorateRunPacketKeepsContentUriWhenSignedUrlGenerationFails() {
        UUID artifactId = UUID.randomUUID();
        Artifact screenshot = artifact(artifactId, ArtifactType.SCREENSHOT, "image/png");
        when(artifactPresignedUrlGenerator.generateGetUrl(screenshot, Duration.ofSeconds(3600)))
                .thenThrow(new RuntimeException("presign unavailable"));

        Map<String, Object> decorated = newDecorator(20).decorateRunPacket(
                packet(List.of("artifact:" + artifactId), artifactId),
                List.of(screenshot)
        );

        assertThat(firstArtifact(decorated))
                .containsEntry("uri", "/api/runs/run-id/artifacts/" + artifactId + "/content")
                .doesNotContainKey("signed_url");
    }

    @Test
    void decorateRunPacketRemovesStaleSignedUrlWhenArtifactMetadataIsUnavailable() {
        UUID artifactId = UUID.randomUUID();

        Map<String, Object> decorated = newDecorator(20).decorateRunPacket(
                packetWithSignedUrl(List.of("artifact:" + artifactId), artifactId),
                List.of()
        );

        assertThat(firstArtifact(decorated)).doesNotContainKey("signed_url");
        verify(artifactPresignedUrlGenerator, never()).generateGetUrl(any(), any());
    }

    private EvidencePacketSignedUrlDecorator newDecorator(int maxSignedUrlCount) {
        return new EvidencePacketSignedUrlDecorator(
                artifactPresignedUrlGenerator,
                Duration.ofSeconds(3600),
                maxSignedUrlCount
        );
    }

    private Map<String, Object> packet(List<String> artifactRefs, UUID... artifactIds) {
        return Map.of(
                "checkpoints", List.of(Map.of("artifact_refs", artifactRefs)),
                "artifacts", java.util.Arrays.stream(artifactIds)
                        .map(artifactId -> Map.<String, Object>of(
                                "artifact_id", artifactId.toString(),
                                "type", "screenshot",
                                "uri", "/api/runs/run-id/artifacts/" + artifactId + "/content",
                                "mime_type", "image/png"
                        ))
                        .toList()
        );
    }

    private Map<String, Object> packetWithSignedUrl(List<String> artifactRefs, UUID artifactId) {
        return Map.of(
                "checkpoints", List.of(Map.of("artifact_refs", artifactRefs)),
                "artifacts", List.of(Map.<String, Object>of(
                        "artifact_id", artifactId.toString(),
                        "type", "screenshot",
                        "uri", "/api/runs/run-id/artifacts/" + artifactId + "/content",
                        "signed_url", "https://stale.example.com/image.png?X-Amz-Signature=expired",
                        "mime_type", "image/png"
                ))
        );
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> artifacts(Map<String, Object> packet) {
        return (List<Map<String, Object>>) packet.get("artifacts");
    }

    private Map<String, Object> firstArtifact(Map<String, Object> packet) {
        return artifacts(packet).get(0);
    }

    private Artifact artifact(UUID artifactId, ArtifactType artifactType, String mimeType) {
        Artifact artifact = new Artifact();
        artifact.setId(artifactId);
        artifact.setRunId(UUID.randomUUID());
        artifact.setArtifactType(artifactType);
        artifact.setS3Bucket("wedge-artifacts");
        artifact.setS3Key("runs/" + artifactId + ".png");
        artifact.setMimeType(mimeType);
        return artifact;
    }
}
