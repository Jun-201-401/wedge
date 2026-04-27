package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EvidenceServiceTest {
    @Mock
    private RunService runService;

    @Mock
    private ArtifactMapper artifactMapper;

    @Mock
    private CheckpointMapper checkpointMapper;

    @Mock
    private ObservationMapper observationMapper;

    @Test
    void listRunArtifactsAddsPrototypeContentUrlAndStepKey() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(sampleArtifact(runId, artifactId)));
        EvidenceService evidenceService = newService();

        List<ArtifactResponse> artifacts = evidenceService.listRunArtifacts(runId);

        assertThat(artifacts).hasSize(1);
        assertThat(artifacts.get(0).id()).isEqualTo(artifactId);
        assertThat(artifacts.get(0).stepKey()).isEqualTo("step_001_goto");
        assertThat(artifacts.get(0).contentUrl()).isEqualTo("/api/runs/" + runId + "/artifacts/" + artifactId + "/content");
    }

    @Test
    void getRunEvidencePacketAssemblesPersistedCallbacks() {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(sampleArtifact(runId, artifactId)));
        when(checkpointMapper.findByRunId(runId)).thenReturn(List.of(sampleCheckpoint(runId, checkpointId, artifactId)));
        when(observationMapper.findByRunId(runId)).thenReturn(List.of(sampleObservation(runId, checkpointId)));
        EvidenceService evidenceService = newService();

        Map<String, Object> packet = evidenceService.getRunEvidencePacket(runId);

        assertThat(packet).containsEntry("schema_version", "0.5");
        assertThat(packet).containsEntry("execution_type", "RUN");
        assertThat(packet.get("run_id")).isEqualTo(runId.toString());
        assertThat((List<?>) packet.get("checkpoints")).hasSize(1);
        assertThat((List<?>) packet.get("artifacts")).hasSize(1);
        @SuppressWarnings("unchecked")
        Map<String, Object> aggregateSignals = (Map<String, Object>) packet.get("aggregate_signals");
        assertThat(aggregateSignals).containsEntry("cta_candidate_count", 1L);
    }

    private EvidenceService newService() {
        return new EvidenceService(
                runService,
                artifactMapper,
                checkpointMapper,
                observationMapper,
                new ObjectMapper(),
                "../runner/.runner-artifacts"
        );
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

    private Artifact sampleArtifact(UUID runId, UUID artifactId) {
        Artifact artifact = new Artifact();
        artifact.setId(artifactId);
        artifact.setRunId(runId);
        artifact.setArtifactType(ArtifactType.SCREENSHOT);
        artifact.setS3Bucket("local-runner");
        artifact.setS3Key(runId + "/step_001_goto/" + artifactId + "-screenshot.png");
        artifact.setMimeType("image/png");
        artifact.setWidth(1440);
        artifact.setHeight(900);
        artifact.setSizeBytes(1234);
        artifact.setSha256("sha256");
        artifact.setCreatedAt(OffsetDateTime.parse("2026-04-21T10:02:00+09:00"));
        return artifact;
    }

    private Checkpoint sampleCheckpoint(UUID runId, UUID checkpointId, UUID artifactId) {
        Checkpoint checkpoint = new Checkpoint();
        checkpoint.setId(checkpointId);
        checkpoint.setRunId(runId);
        checkpoint.setCheckpointKey("cp_001");
        checkpoint.setStage("FIRST_VIEW");
        checkpoint.setTriggerJsonb("{\"actionType\":\"goto\"}");
        checkpoint.setSettleJsonb("{\"strategy\":\"network_idle\",\"durationMs\":1200,\"status\":\"settled\"}");
        checkpoint.setStateJsonb("{\"url\":\"https://example.com\",\"viewport\":{\"width\":1440,\"height\":900}}");
        checkpoint.setDeltaJsonb("[]");
        checkpoint.setArtifactRefsJsonb("[\"artifact:" + artifactId + "\"]");
        checkpoint.setDurationMs(1200);
        return checkpoint;
    }

    private Observation sampleObservation(UUID runId, UUID checkpointId) {
        Observation observation = new Observation();
        observation.setId(UUID.randomUUID());
        observation.setRunId(runId);
        observation.setCheckpointId(checkpointId);
        observation.setObservationKey("cp_001.obs_001");
        observation.setObservationType("cta_candidate");
        observation.setStage("CTA");
        observation.setSourcesJsonb("[\"dom\"]");
        observation.setDataJsonb("{\"target\":\"text=Start free\"}");
        return observation;
    }
}
