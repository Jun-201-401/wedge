package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.api.dto.ArtifactPresignedUrlsResponse;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.api.dto.RunEvidenceSummaryResponse;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.EvidencePacketSnapshot;
import com.wedge.evidence.domain.Observation;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.evidence.infrastructure.CheckpointMapper;
import com.wedge.evidence.infrastructure.EvidencePacketMapper;
import com.wedge.evidence.infrastructure.ObservationMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.net.URI;
import java.net.URL;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
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

    @Mock
    private EvidencePacketMapper evidencePacketMapper;

    @Mock
    private ArtifactContentStore artifactContentStore;

    @Mock
    private ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator;

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
    void getRunEvidencePacketAssemblesPersistedCallbacks() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact artifact = sampleArtifact(runId, artifactId);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(artifact));
        when(checkpointMapper.findByRunId(runId)).thenReturn(List.of(sampleCheckpoint(runId, checkpointId, artifactId)));
        when(observationMapper.findByRunId(runId)).thenReturn(List.of(sampleObservation(runId, checkpointId)));
        when(artifactPresignedUrlGenerator.generateGetUrl(artifact, Duration.ofSeconds(3600)))
                .thenReturn(new URL("https://wedge-artifacts.s3.ap-northeast-2.amazonaws.com/runs/a.png?X-Amz-Signature=test"));
        EvidenceService evidenceService = newService();

        Map<String, Object> packet = evidenceService.getRunEvidencePacket(runId);

        assertThat(packet).containsEntry("schema_version", "0.5");
        assertThat(packet).containsEntry("execution_type", "RUN");
        assertThat(packet.get("run_id")).isEqualTo(runId.toString());
        assertThat((List<?>) packet.get("checkpoints")).hasSize(1);
        assertThat((List<?>) packet.get("artifacts")).hasSize(1);
        assertThat(firstArtifact(packet)).containsEntry(
                "signed_url",
                "https://wedge-artifacts.s3.ap-northeast-2.amazonaws.com/runs/a.png?X-Amz-Signature=test"
        );
        assertEvidenceObservation(packet);
        @SuppressWarnings("unchecked")
        Map<String, Object> aggregateSignals = (Map<String, Object>) packet.get("aggregate_signals");
        assertThat(aggregateSignals)
                .containsEntry("cta_candidate_count", 1L)
                .containsEntry("failed_request_count", 0L)
                .containsEntry("console_error_count", 0L);
    }

    @Test
    void materializeRunEvidencePacketSnapshotPersistsAssembledPacket() {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(sampleArtifact(runId, artifactId)));
        when(checkpointMapper.findByRunId(runId)).thenReturn(List.of(sampleCheckpoint(runId, checkpointId, artifactId)));
        when(observationMapper.findByRunId(runId)).thenReturn(List.of(sampleObservation(runId, checkpointId)));
        when(evidencePacketMapper.upsertRunSnapshot(any(EvidencePacketSnapshot.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        EvidenceService evidenceService = newService();

        EvidencePacketSnapshot snapshot = evidenceService.materializeRunEvidencePacketSnapshot(runId);

        assertThat(snapshot.getId()).isNotNull();
        assertThat(snapshot.getRunId()).isEqualTo(runId);
        assertThat(snapshot.getSchemaVersion()).isEqualTo("0.5");
        assertThat(snapshot.getCheckpointCount()).isEqualTo(1);
        assertThat(snapshot.getObservationCount()).isEqualTo(1);
        assertThat(snapshot.getArtifactCount()).isEqualTo(1);
        assertThat(snapshot.getPacketJsonb()).contains("\"run_id\":\"" + runId + "\"");
        assertThat(snapshot.getPacketJsonb()).doesNotContain("signed_url");
    }

    @Test
    void getEvidencePacketSnapshotAddsFreshSignedUrlsWithoutPersistingThem() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact artifact = sampleArtifact(runId, artifactId);
        Map<String, Object> storedPacket = new EvidencePacketAssembler(new ObjectMapper()).assemble(
                sampleRun(runId),
                List.of(artifact),
                List.of(sampleCheckpoint(runId, checkpointId, artifactId)),
                List.of(sampleObservation(runId, checkpointId))
        );
        EvidencePacketSnapshot snapshot = new EvidencePacketSnapshot();
        snapshot.setId(UUID.randomUUID());
        snapshot.setExecutionType("RUN");
        snapshot.setRunId(runId);
        snapshot.setPacketJsonb(new ObjectMapper().writeValueAsString(storedPacket));
        when(evidencePacketMapper.findById(snapshot.getId())).thenReturn(Optional.of(snapshot));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(artifact));
        when(artifactPresignedUrlGenerator.generateGetUrl(artifact, Duration.ofSeconds(3600)))
                .thenReturn(new URL("https://wedge-artifacts.s3.ap-northeast-2.amazonaws.com/runs/fresh.png?X-Amz-Signature=fresh"));
        EvidenceService evidenceService = newService();

        Map<String, Object> packet = evidenceService.getEvidencePacketSnapshot(snapshot.getId());

        assertThat(snapshot.getPacketJsonb()).doesNotContain("signed_url");
        assertThat(firstArtifact(packet)).containsEntry(
                "signed_url",
                "https://wedge-artifacts.s3.ap-northeast-2.amazonaws.com/runs/fresh.png?X-Amz-Signature=fresh"
        );
    }

    @Test
    void getRunArtifactContentLoadsFromConfiguredStore() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact artifact = sampleArtifact(runId, artifactId);
        Resource resource = new ByteArrayResource("artifact".getBytes());
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunIdAndId(runId, artifactId)).thenReturn(Optional.of(artifact));
        when(artifactContentStore.load(artifact)).thenReturn(resource);
        EvidenceService evidenceService = newService();

        EvidenceService.ArtifactContent content = evidenceService.getRunArtifactContent(runId, artifactId);

        assertThat(content.resource()).isSameAs(resource);
        assertThat(content.mimeType()).isEqualTo("image/png");
        verify(artifactContentStore).load(artifact);
    }

    @Test
    void getRunImageArtifactContentRejectsNonImageBeforeLoadingStore() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact artifact = sampleArtifact(runId, artifactId);
        artifact.setMimeType("text/html");
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunIdAndId(runId, artifactId)).thenReturn(Optional.of(artifact));
        EvidenceService evidenceService = newService();

        assertThatThrownBy(() -> evidenceService.getRunImageArtifactContent(runId, artifactId))
                .isInstanceOfSatisfying(BusinessException.class, exception -> {
                    assertThat(exception.errorCode()).isEqualTo(ErrorCode.RUN_NOT_FOUND);
                    assertThat(exception.getMessage()).isEqualTo("Image artifact was not found for the run.");
                });
        verify(artifactContentStore, never()).load(any());
    }

    @Test
    void createRunArtifactPresignedUrlsReturnsTimeLimitedUrlsForImageArtifacts() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact artifact = sampleArtifact(runId, artifactId);
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(artifact));
        when(artifactPresignedUrlGenerator.generateGetUrl(artifact, Duration.ofSeconds(3600)))
                .thenReturn(new URL("https://wedge-artifacts-prod.s3.ap-northeast-2.amazonaws.com/runs/a.png?X-Amz-Signature=test"));
        EvidenceService evidenceService = newService();

        ArtifactPresignedUrlsResponse response = evidenceService.createRunArtifactPresignedUrls(runId, List.of(artifactId));

        assertThat(response.urls()).hasSize(1);
        assertThat(response.urls().get(0).artifactId()).isEqualTo(artifactId);
        assertThat(response.urls().get(0).mimeType()).isEqualTo("image/png");
        assertThat(response.urls().get(0).expiresAt()).isEqualTo(Instant.parse("2026-05-08T08:00:00Z"));
        assertThat(response.urls().get(0).url()).contains("X-Amz-Signature=test");
    }

    @Test
    void createRunArtifactPresignedUrlsRejectsMoreThanConfiguredMaxCount() {
        UUID runId = UUID.randomUUID();
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        EvidenceService evidenceService = newService();
        List<UUID> artifactIds = java.util.stream.IntStream.range(0, 21)
                .mapToObj(ignored -> UUID.randomUUID())
                .toList();

        assertThatThrownBy(() -> evidenceService.createRunArtifactPresignedUrls(runId, artifactIds))
                .isInstanceOfSatisfying(BusinessException.class, exception -> {
                    assertThat(exception.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST);
                    assertThat(exception.getMessage()).isEqualTo("artifactIds must contain at most 20 items.");
                });
    }

    @Test
    void createRunArtifactPresignedUrlsRejectsNonImageArtifacts() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        Artifact artifact = sampleArtifact(runId, artifactId);
        artifact.setMimeType("text/html");
        when(runService.getRun(runId)).thenReturn(sampleRun(runId));
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(artifact));
        EvidenceService evidenceService = newService();

        assertThatThrownBy(() -> evidenceService.createRunArtifactPresignedUrls(runId, List.of(artifactId)))
                .isInstanceOfSatisfying(BusinessException.class, exception -> {
                    assertThat(exception.errorCode()).isEqualTo(ErrorCode.INVALID_REQUEST);
                    assertThat(exception.getMessage()).isEqualTo("Only PNG, JPEG, and WebP image artifacts can be presigned.");
                });
    }

    @Test
    void getRunEvidenceSummaryReturnsLatestEvidenceForLivePolling() {
        UUID runId = UUID.randomUUID();
        UUID checkpointId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(artifactMapper.findByRunId(runId)).thenReturn(List.of(sampleArtifact(runId, artifactId)));
        when(checkpointMapper.findByRunId(runId)).thenReturn(List.of(sampleCheckpoint(runId, checkpointId, artifactId)));
        when(observationMapper.findByRunId(runId)).thenReturn(List.of(sampleObservation(runId, checkpointId)));
        EvidenceService evidenceService = newService();

        RunEvidenceSummaryResponse summary = evidenceService.getRunEvidenceSummary(sampleRun(runId));

        assertThat(summary.latestCheckpoint()).isNotNull();
        assertThat(summary.latestCheckpoint().checkpointId()).isEqualTo("cp_001");
        assertThat(summary.latestCheckpoint().stage()).isEqualTo("FIRST_VIEW");
        assertThat(summary.latestCheckpoint().url()).isEqualTo("https://example.com");
        assertThat(summary.latestCheckpoint().observationCount()).isEqualTo(1);
        assertThat(summary.latestCheckpoint().artifactRefCount()).isEqualTo(1);
        assertThat(summary.latestArtifact()).isNotNull();
        assertThat(summary.latestArtifact().id()).isEqualTo(artifactId);
        assertThat(summary.latestFrameArtifact()).isNotNull();
        assertThat(summary.latestFrameArtifact().id()).isEqualTo(artifactId);
        assertThat(summary.latestFrameArtifact().contentUrl()).isEqualTo("/api/runs/" + runId + "/artifacts/" + artifactId + "/content");
        assertThat(summary.evidenceCounts().checkpointCount()).isEqualTo(1);
        assertThat(summary.evidenceCounts().observationCount()).isEqualTo(1);
        assertThat(summary.evidenceCounts().artifactCount()).isEqualTo(1);
    }

    private EvidenceService newService() {
        return new EvidenceService(
                runService,
                artifactMapper,
                checkpointMapper,
                observationMapper,
                evidencePacketMapper,
                new EvidencePacketAssembler(new ObjectMapper()),
                new EvidencePacketSignedUrlDecorator(
                        artifactPresignedUrlGenerator,
                        Duration.ofSeconds(3600),
                        20
                ),
                artifactContentStore,
                artifactPresignedUrlGenerator,
                new ObjectMapper(),
                Clock.fixed(Instant.parse("2026-05-08T07:00:00Z"), ZoneOffset.UTC),
                20,
                Duration.ofSeconds(3600)
        );
    }

    @SuppressWarnings("unchecked")
    private void assertEvidenceObservation(Map<String, Object> packet) {
        List<Map<String, Object>> checkpoints = (List<Map<String, Object>>) packet.get("checkpoints");
        assertThat(checkpoints.get(0)).containsEntry("step_id", "step_001_goto");
        List<Map<String, Object>> observations = (List<Map<String, Object>>) checkpoints.get(0).get("observations");
        Map<String, Object> observation = observations.get(0);
        assertThat(observation).containsEntry("observation_id", "obs_001");
        assertThat(observation).containsEntry("type", "cta_candidate");
        assertThat(observation).containsEntry("stage", "CTA");
        assertThat((List<String>) observation.get("source")).containsExactly("dom");
        assertThat((Map<String, Object>) observation.get("data")).containsEntry("target", "text=Start free");

        Map<String, Object> decisionStageSummary = (Map<String, Object>) packet.get("decisionStageSummary");
        assertThat((Map<String, Object>) decisionStageSummary.get("FIRST_VIEW")).containsEntry("status", "OBSERVED");
        assertThat((Map<String, Object>) decisionStageSummary.get("VALUE")).containsEntry("status", "NOT_OBSERVED");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> firstArtifact(Map<String, Object> packet) {
        return ((List<Map<String, Object>>) packet.get("artifacts")).get(0);
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
        checkpoint.setStepKey("step_001_goto");
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
