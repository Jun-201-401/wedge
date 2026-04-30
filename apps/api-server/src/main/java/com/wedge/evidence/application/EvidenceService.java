package com.wedge.evidence.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.api.dto.EvidenceCountsResponse;
import com.wedge.evidence.api.dto.LatestCheckpointResponse;
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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EvidenceService {
    private static final String EVIDENCE_SCHEMA_VERSION = "0.5";

    private final RunService runService;
    private final ArtifactMapper artifactMapper;
    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final EvidencePacketMapper evidencePacketMapper;
    private final EvidencePacketAssembler evidencePacketAssembler;
    private final ArtifactContentStore artifactContentStore;
    private final ObjectMapper objectMapper;

    public EvidenceService(
            RunService runService,
            ArtifactMapper artifactMapper,
            CheckpointMapper checkpointMapper,
            ObservationMapper observationMapper,
            EvidencePacketMapper evidencePacketMapper,
            EvidencePacketAssembler evidencePacketAssembler,
            ArtifactContentStore artifactContentStore,
            ObjectMapper objectMapper
    ) {
        this.runService = runService;
        this.artifactMapper = artifactMapper;
        this.checkpointMapper = checkpointMapper;
        this.observationMapper = observationMapper;
        this.evidencePacketMapper = evidencePacketMapper;
        this.evidencePacketAssembler = evidencePacketAssembler;
        this.artifactContentStore = artifactContentStore;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<ArtifactResponse> listRunArtifacts(UUID runId) {
        runService.getRun(runId);
        return artifactMapper.findByRunId(runId).stream()
                .map(ArtifactResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public RunEvidenceSummaryResponse getRunEvidenceSummary(UUID runId) {
        return getRunEvidenceSummary(runService.getRun(runId));
    }

    @Transactional(readOnly = true)
    public RunEvidenceSummaryResponse getRunEvidenceSummary(RunResponse run) {
        UUID runId = run.id();
        List<Artifact> artifacts = artifactMapper.findByRunId(runId);
        List<Checkpoint> checkpoints = checkpointMapper.findByRunId(runId);
        List<Observation> observations = observationMapper.findByRunId(runId);

        Checkpoint latestCheckpoint = checkpoints.isEmpty() ? null : checkpoints.get(checkpoints.size() - 1);
        Artifact latestArtifact = artifacts.isEmpty() ? null : artifacts.get(0);
        Artifact latestFrameArtifact = findLatestFrameArtifact(artifacts);

        return new RunEvidenceSummaryResponse(
                toLatestCheckpointResponse(latestCheckpoint, observations),
                latestArtifact == null ? null : ArtifactResponse.from(latestArtifact),
                latestFrameArtifact == null ? null : ArtifactResponse.from(latestFrameArtifact),
                new EvidenceCountsResponse(checkpoints.size(), observations.size(), artifacts.size())
        );
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getRunEvidencePacket(UUID runId) {
        RunResponse run = runService.getRun(runId);
        return evidencePacketAssembler.assemble(
                run,
                artifactMapper.findByRunId(runId),
                checkpointMapper.findByRunId(runId),
                observationMapper.findByRunId(runId)
        );
    }

    @Transactional
    public EvidencePacketSnapshot materializeRunEvidencePacketSnapshot(UUID runId) {
        RunResponse run = runService.getRun(runId);
        List<Artifact> artifacts = artifactMapper.findByRunId(runId);
        List<Checkpoint> checkpoints = checkpointMapper.findByRunId(runId);
        List<Observation> observations = observationMapper.findByRunId(runId);
        Map<String, Object> packet = evidencePacketAssembler.assemble(run, artifacts, checkpoints, observations);

        EvidencePacketSnapshot snapshot = new EvidencePacketSnapshot();
        snapshot.setId(UUID.randomUUID());
        snapshot.setExecutionType("RUN");
        snapshot.setRunId(runId);
        snapshot.setSchemaVersion(String.valueOf(packet.getOrDefault("schema_version", EVIDENCE_SCHEMA_VERSION)));
        snapshot.setPacketJsonb(writeJson(packet));
        snapshot.setCheckpointCount(checkpoints.size());
        snapshot.setObservationCount(observations.size());
        snapshot.setArtifactCount(artifacts.size());
        return evidencePacketMapper.upsertRunSnapshot(snapshot);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getEvidencePacketSnapshot(UUID evidencePacketId) {
        EvidencePacketSnapshot snapshot = evidencePacketMapper.findById(evidencePacketId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND, "EvidencePacket snapshot was not found."));
        return readJsonMap(snapshot.getPacketJsonb());
    }

    @Transactional(readOnly = true)
    public ArtifactContent getRunArtifactContent(UUID runId, UUID artifactId) {
        runService.getRun(runId);
        Artifact artifact = artifactMapper.findByRunIdAndId(runId, artifactId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact was not found."));
        Resource resource = artifactContentStore.load(artifact);
        return new ArtifactContent(resource, artifact.getMimeType());
    }

    private Artifact findLatestFrameArtifact(List<Artifact> artifacts) {
        return artifacts.stream()
                .filter(artifact -> artifact.getArtifactType() == ArtifactType.SCREENSHOT || artifact.getArtifactType() == ArtifactType.FRAME)
                .findFirst()
                .orElse(null);
    }

    private LatestCheckpointResponse toLatestCheckpointResponse(Checkpoint checkpoint, List<Observation> observations) {
        if (checkpoint == null) {
            return null;
        }
        int observationCount = (int) observations.stream()
                .filter(observation -> checkpoint.getId().equals(observation.getCheckpointId()))
                .count();
        return new LatestCheckpointResponse(
                checkpoint.getCheckpointKey(),
                checkpoint.getStepId(),
                checkpoint.getStage(),
                readCheckpointUrl(checkpoint),
                checkpoint.getCapturedAt(),
                checkpoint.getDurationMs(),
                observationCount,
                evidencePacketAssembler.readJsonList(checkpoint.getArtifactRefsJsonb()).size()
        );
    }

    private String readCheckpointUrl(Checkpoint checkpoint) {
        Object url = evidencePacketAssembler.readJsonMap(checkpoint.getStateJsonb()).get("url");
        return url == null ? null : url.toString();
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize EvidencePacket snapshot.", exception);
        }
    }

    private Map<String, Object> readJsonMap(String rawJson) {
        try {
            return objectMapper.readValue(rawJson, new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored EvidencePacket snapshot JSON is invalid.", exception);
        }
    }

    public record ArtifactContent(Resource resource, String mimeType) {
    }
}
