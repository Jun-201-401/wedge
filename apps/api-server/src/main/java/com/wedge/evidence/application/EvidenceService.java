package com.wedge.evidence.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.api.dto.ArtifactPresignedUrlItemResponse;
import com.wedge.evidence.api.dto.ArtifactPresignedUrlsResponse;
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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EvidenceService {
    private static final String EVIDENCE_SCHEMA_VERSION = "0.5";
    private static final Set<String> PRESIGNABLE_IMAGE_MIME_TYPES = Set.of(
            "image/png",
            "image/jpeg",
            "image/webp"
    );

    private final RunService runService;
    private final ArtifactMapper artifactMapper;
    private final CheckpointMapper checkpointMapper;
    private final ObservationMapper observationMapper;
    private final EvidencePacketMapper evidencePacketMapper;
    private final EvidencePacketAssembler evidencePacketAssembler;
    private final EvidencePacketSignedUrlDecorator evidencePacketSignedUrlDecorator;
    private final ArtifactContentStore artifactContentStore;
    private final ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final int presignedUrlMaxCount;
    private final Duration presignedUrlTtl;

    @Autowired
    public EvidenceService(
            RunService runService,
            ArtifactMapper artifactMapper,
            CheckpointMapper checkpointMapper,
            ObservationMapper observationMapper,
            EvidencePacketMapper evidencePacketMapper,
            EvidencePacketAssembler evidencePacketAssembler,
            EvidencePacketSignedUrlDecorator evidencePacketSignedUrlDecorator,
            ArtifactContentStore artifactContentStore,
            ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator,
            ObjectMapper objectMapper,
            @Value("${wedge.artifacts.presigned-url.max-count:20}") int presignedUrlMaxCount,
            @Value("${wedge.artifacts.presigned-url.ttl-seconds:3600}") long presignedUrlTtlSeconds
    ) {
        this(
                runService,
                artifactMapper,
                checkpointMapper,
                observationMapper,
                evidencePacketMapper,
                evidencePacketAssembler,
                evidencePacketSignedUrlDecorator,
                artifactContentStore,
                artifactPresignedUrlGenerator,
                objectMapper,
                Clock.systemUTC(),
                presignedUrlMaxCount,
                Duration.ofSeconds(presignedUrlTtlSeconds)
        );
    }

    EvidenceService(
            RunService runService,
            ArtifactMapper artifactMapper,
            CheckpointMapper checkpointMapper,
            ObservationMapper observationMapper,
            EvidencePacketMapper evidencePacketMapper,
            EvidencePacketAssembler evidencePacketAssembler,
            EvidencePacketSignedUrlDecorator evidencePacketSignedUrlDecorator,
            ArtifactContentStore artifactContentStore,
            ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator,
            ObjectMapper objectMapper,
            Clock clock,
            int presignedUrlMaxCount,
            Duration presignedUrlTtl
    ) {
        this.runService = runService;
        this.artifactMapper = artifactMapper;
        this.checkpointMapper = checkpointMapper;
        this.observationMapper = observationMapper;
        this.evidencePacketMapper = evidencePacketMapper;
        this.evidencePacketAssembler = evidencePacketAssembler;
        this.evidencePacketSignedUrlDecorator = evidencePacketSignedUrlDecorator;
        this.artifactContentStore = artifactContentStore;
        this.artifactPresignedUrlGenerator = artifactPresignedUrlGenerator;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.presignedUrlMaxCount = presignedUrlMaxCount;
        this.presignedUrlTtl = presignedUrlTtl;
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
        List<Artifact> artifacts = artifactMapper.findByRunId(runId);
        Map<String, Object> packet = evidencePacketAssembler.assemble(
                run,
                artifacts,
                checkpointMapper.findByRunId(runId),
                observationMapper.findByRunId(runId)
        );
        return evidencePacketSignedUrlDecorator.decorateRunPacket(packet, artifacts);
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
        Map<String, Object> packet = readJsonMap(snapshot.getPacketJsonb());
        if (!"RUN".equals(snapshot.getExecutionType()) || snapshot.getRunId() == null) {
            return packet;
        }
        return evidencePacketSignedUrlDecorator.decorateRunPacket(packet, artifactMapper.findByRunId(snapshot.getRunId()));
    }

    @Transactional(readOnly = true)
    public ArtifactContent getRunArtifactContent(UUID runId, UUID artifactId) {
        runService.getRun(runId);
        Artifact artifact = findRunArtifact(runId, artifactId);
        Resource resource = artifactContentStore.load(artifact);
        return new ArtifactContent(resource, artifact.getMimeType());
    }

    @Transactional(readOnly = true)
    public ArtifactContent getRunImageArtifactContent(UUID runId, UUID artifactId) {
        runService.getRun(runId);
        Artifact artifact = findRunArtifact(runId, artifactId);
        if (!isPresignableImage(artifact)) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND, "Image artifact was not found for the run.");
        }
        Resource resource = artifactContentStore.load(artifact);
        return new ArtifactContent(resource, artifact.getMimeType(), artifactFilename(artifact));
    }

    @Transactional(readOnly = true)
    public ArtifactPresignedUrlsResponse createRunArtifactPresignedUrls(UUID runId, List<UUID> artifactIds) {
        runService.getRun(runId);
        List<UUID> requestedArtifactIds = normalizeRequestedArtifactIds(artifactIds);
        Map<UUID, Artifact> artifactsById = artifactMapper.findByRunId(runId).stream()
                .collect(Collectors.toMap(Artifact::getId, Function.identity()));
        Instant expiresAt = Instant.now(clock).plus(presignedUrlTtl);

        List<ArtifactPresignedUrlItemResponse> urls = requestedArtifactIds.stream()
                .map(artifactId -> toPresignedUrlItem(runId, artifactId, artifactsById, expiresAt))
                .toList();
        return new ArtifactPresignedUrlsResponse(urls);
    }

    private List<UUID> normalizeRequestedArtifactIds(List<UUID> artifactIds) {
        if (artifactIds == null || artifactIds.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "artifactIds is required.");
        }
        if (presignedUrlMaxCount < 1) {
            throw new BusinessException(ErrorCode.ARTIFACT_PRESIGNED_URL_UNAVAILABLE, "Artifact presigned URL max count must be positive.");
        }

        List<UUID> distinctArtifactIds = new LinkedHashSet<>(artifactIds).stream().toList();
        if (distinctArtifactIds.size() > presignedUrlMaxCount) {
            throw new BusinessException(
                    ErrorCode.INVALID_REQUEST,
                    "artifactIds must contain at most " + presignedUrlMaxCount + " items."
            );
        }
        return distinctArtifactIds;
    }

    private ArtifactPresignedUrlItemResponse toPresignedUrlItem(
            UUID runId,
            UUID artifactId,
            Map<UUID, Artifact> artifactsById,
            Instant expiresAt
    ) {
        Artifact artifact = artifactsById.get(artifactId);
        if (artifact == null) {
            throw new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact was not found for the run.");
        }
        if (!isPresignableImage(artifact)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Only PNG, JPEG, and WebP image artifacts can be presigned.");
        }
        return new ArtifactPresignedUrlItemResponse(
                artifact.getId(),
                artifact.getArtifactType(),
                artifact.getMimeType(),
                artifactPresignedUrlGenerator.generateGetUrl(artifact, presignedUrlTtl).toString(),
                expiresAt
        );
    }

    private boolean isPresignableImage(Artifact artifact) {
        String mimeType = artifact.getMimeType();
        return mimeType != null && PRESIGNABLE_IMAGE_MIME_TYPES.contains(mimeType.toLowerCase());
    }

    private Artifact findRunArtifact(UUID runId, UUID artifactId) {
        return artifactMapper.findByRunIdAndId(runId, artifactId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND, "Artifact was not found."));
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

    private String artifactFilename(Artifact artifact) {
        String key = artifact.getS3Key();
        if (key == null || key.isBlank()) {
            return artifact.getId().toString();
        }
        int separatorIndex = key.lastIndexOf('/');
        return separatorIndex >= 0 ? key.substring(separatorIndex + 1) : key;
    }

    public record ArtifactContent(Resource resource, String mimeType, String filename) {
    }
}
