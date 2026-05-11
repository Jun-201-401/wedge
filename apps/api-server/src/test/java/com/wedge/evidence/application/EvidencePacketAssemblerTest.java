package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EvidencePacketAssemblerTest {
    @Test
    void assembleKeepsArtifactMetadataStableWithoutSignedUrl() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact screenshot = artifact(runId, artifactId, ArtifactType.SCREENSHOT, "image/png");
        EvidencePacketAssembler assembler = new EvidencePacketAssembler(new ObjectMapper());

        Map<String, Object> packet = assembler.assemble(sampleRun(runId), List.of(screenshot), List.of(), List.of());

        assertThat(firstArtifact(packet))
                .containsEntry("uri", "/api/runs/" + runId + "/artifacts/" + artifactId + "/content")
                .doesNotContainKey("signed_url");
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
