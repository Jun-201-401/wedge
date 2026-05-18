package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
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

    @Test
    void assembleAddsSafetyBlockSummaryFromRunnerFailureObservations() {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        EvidencePacketAssembler assembler = new EvidencePacketAssembler(new ObjectMapper());

        Map<String, Object> packet = assembler.assemble(
                sampleRun(runId),
                List.of(),
                List.of(checkpoint(runId, checkpointId)),
                List.of(safetyBlockObservation(runId, checkpointId))
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> aggregateSignals = (Map<String, Object>) packet.get("aggregate_signals");
        assertThat(aggregateSignals)
                .containsEntry("safety_block_count", 1L)
                .containsEntry("safety_block_reasons", List.of("POLICY_EXTERNAL_NAVIGATION_BLOCKED"));
        @SuppressWarnings("unchecked")
        Map<String, Object> safetyBlockCountByStage = (Map<String, Object>) aggregateSignals.get("safety_block_count_by_stage");
        assertThat(safetyBlockCountByStage)
                .containsEntry("CTA", 1L);

        @SuppressWarnings("unchecked")
        Map<String, Object> decisionStageSummary = (Map<String, Object>) packet.get("decisionStageSummary");
        @SuppressWarnings("unchecked")
        Map<String, Object> ctaSummary = (Map<String, Object>) decisionStageSummary.get("CTA");
        assertThat(ctaSummary)
                .containsEntry("status", "BLOCKED")
                .containsEntry("observationCount", 1L);
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

    private Checkpoint checkpoint(UUID runId, UUID checkpointId) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(checkpointId);
        checkpoint.setRunId(runId);
        checkpoint.setStepKey("step_002_external_login");
        checkpoint.setCheckpointKey("cp_002");
        checkpoint.setStage("CTA");
        checkpoint.setTriggerJsonb("{\"actionType\":\"click\"}");
        checkpoint.setSettleJsonb("{\"strategy\":\"fixed_short\",\"durationMs\":1,\"status\":\"settled\"}");
        checkpoint.setStateJsonb("{\"url\":\"https://nid.naver.com\"}");
        checkpoint.setDeltaJsonb("[]");
        checkpoint.setArtifactRefsJsonb("[]");
        checkpoint.setDurationMs(1);
        return checkpoint;
    }

    private Observation safetyBlockObservation(UUID runId, UUID checkpointId) {
        Observation observation = new Observation();
        observation.setId(UUID.randomUUID());
        observation.setRunId(runId);
        observation.setCheckpointId(checkpointId);
        observation.setObservationKey("cp_002.obs_runner_failure");
        observation.setObservationType("runner_failure");
        observation.setStage("CTA");
        observation.setSourcesJsonb("[\"scenario_log\",\"browser\"]");
        observation.setDataJsonb("""
                {
                  "failure_code": "POLICY_EXTERNAL_NAVIGATION_BLOCKED",
                  "failure_message": "Scenario safety forbids visiting external origin.",
                  "failed_step_key": "step_002_external_login"
                }
                """);
        return observation;
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
