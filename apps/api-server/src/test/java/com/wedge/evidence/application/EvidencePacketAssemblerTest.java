package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.net.URL;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EvidencePacketAssemblerTest {
    @Mock
    private ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator;

    @Test
    void assembleAddsSignedUrlForScreenshotImageArtifact() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact screenshot = artifact(runId, artifactId, ArtifactType.SCREENSHOT, "image/png");
        URL signedUrl = new URL("https://wedge-artifacts.s3.ap-northeast-2.amazonaws.com/runs/a.png?X-Amz-Signature=test");
        when(artifactPresignedUrlGenerator.generateGetUrl(screenshot, Duration.ofSeconds(3600))).thenReturn(signedUrl);
        EvidencePacketAssembler assembler = newAssembler();

        Map<String, Object> packet = assembler.assemble(sampleRun(runId), List.of(screenshot), List.of(), List.of());

        assertThat(firstArtifact(packet))
                .containsEntry("uri", "/api/runs/" + runId + "/artifacts/" + artifactId + "/content")
                .containsEntry("signed_url", signedUrl.toString());
    }

    @Test
    void assembleDoesNotAddSignedUrlForNonImageArtifact() {
        UUID runId = UUID.randomUUID();
        Artifact domSnapshot = artifact(runId, UUID.randomUUID(), ArtifactType.DOM_SNAPSHOT, "text/html");
        EvidencePacketAssembler assembler = newAssembler();

        Map<String, Object> packet = assembler.assemble(sampleRun(runId), List.of(domSnapshot), List.of(), List.of());

        assertThat(firstArtifact(packet)).doesNotContainKey("signed_url");
        verify(artifactPresignedUrlGenerator, never()).generateGetUrl(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void assembleKeepsContentUriWhenSignedUrlGenerationFails() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact screenshot = artifact(runId, artifactId, ArtifactType.SCREENSHOT, "image/png");
        when(artifactPresignedUrlGenerator.generateGetUrl(screenshot, Duration.ofSeconds(3600)))
                .thenThrow(new RuntimeException("presign unavailable"));
        EvidencePacketAssembler assembler = newAssembler();

        Map<String, Object> packet = assembler.assemble(sampleRun(runId), List.of(screenshot), List.of(), List.of());

        assertThat(firstArtifact(packet))
                .containsEntry("uri", "/api/runs/" + runId + "/artifacts/" + artifactId + "/content")
                .doesNotContainKey("signed_url");
    }

    private EvidencePacketAssembler newAssembler() {
        return new EvidencePacketAssembler(
                new ObjectMapper(),
                artifactPresignedUrlGenerator,
                Duration.ofSeconds(3600)
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> firstArtifact(Map<String, Object> packet) {
        return ((List<Map<String, Object>>) packet.get("artifacts")).get(0);
    }

    private Artifact artifact(UUID runId, UUID artifactId, ArtifactType artifactType, String mimeType) {
        Artifact artifact = new Artifact();
        artifact.setId(artifactId);
        artifact.setRunId(runId);
        artifact.setArtifactType(artifactType);
        artifact.setS3Bucket("wedge-artifacts");
        artifact.setS3Key(runId + "/step_001_goto/" + artifactId + "-artifact");
        artifact.setMimeType(mimeType);
        artifact.setWidth(1440);
        artifact.setHeight(900);
        artifact.setSizeBytes(1234);
        artifact.setCreatedAt(OffsetDateTime.parse("2026-04-21T10:02:00+09:00"));
        return artifact;
    }

    private RunResponse sampleRun(UUID runId) {
        return new RunResponse(
                runId,
                "run",
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "첫 화면 CTA 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                RunStatus.COMPLETED,
                ResultCompleteness.FINAL,
                AnalysisStatus.NOT_STARTED,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
