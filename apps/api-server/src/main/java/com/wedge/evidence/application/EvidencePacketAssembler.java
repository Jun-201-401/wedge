package com.wedge.evidence.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.domain.Checkpoint;
import com.wedge.evidence.domain.Observation;
import com.wedge.run.api.dto.RunResponse;
import java.net.URI;
import java.net.URL;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class EvidencePacketAssembler {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};
    private static final TypeReference<List<Object>> LIST_TYPE = new TypeReference<>() {};
    private static final String EVIDENCE_SCHEMA_VERSION = "0.5";
    private static final Set<String> SIGNABLE_IMAGE_MIME_TYPES = Set.of(
            "image/png",
            "image/jpeg",
            "image/webp"
    );

    private final ObjectMapper objectMapper;
    private final ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator;
    private final Duration signedUrlTtl;

    @Autowired
    public EvidencePacketAssembler(
            ObjectMapper objectMapper,
            ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator,
            @Value("${wedge.artifacts.presigned-url.ttl-seconds:3600}") long signedUrlTtlSeconds
    ) {
        this(objectMapper, artifactPresignedUrlGenerator, Duration.ofSeconds(signedUrlTtlSeconds));
    }

    public EvidencePacketAssembler(ObjectMapper objectMapper) {
        this(objectMapper, null, Duration.ZERO);
    }

    EvidencePacketAssembler(
            ObjectMapper objectMapper,
            ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator,
            Duration signedUrlTtl
    ) {
        this.objectMapper = objectMapper;
        this.artifactPresignedUrlGenerator = artifactPresignedUrlGenerator;
        this.signedUrlTtl = signedUrlTtl;
    }

    public Map<String, Object> assemble(RunResponse run, List<Artifact> artifacts, List<Checkpoint> checkpoints, List<Observation> observations) {
        Map<UUID, List<Observation>> observationsByCheckpointId = groupObservationsByCheckpointId(observations);
        Map<String, Object> packet = new LinkedHashMap<>();
        packet.put("schema_version", EVIDENCE_SCHEMA_VERSION);
        packet.put("execution_type", "RUN");
        packet.put("run_id", run.id().toString());
        packet.put("discovery_id", null);
        packet.put("url", run.startUrl().toString());
        packet.put("final_url", latestCheckpointUrl(checkpoints, run.startUrl()));
        packet.put("scenario", createScenario(run));
        packet.put("environment", createEnvironment(run, checkpoints));
        packet.put("checkpoints", checkpoints.stream()
                .map(checkpoint -> toEvidenceCheckpoint(checkpoint, observationsByCheckpointId.getOrDefault(checkpoint.getId(), List.of())))
                .toList());
        packet.put("aggregate_signals", createAggregateSignals(checkpoints, observations, artifacts));
        packet.put("scenario_fit", null);
        packet.put("decisionStageSummary", createDecisionStageSummary(checkpoints, observations));
        packet.put("artifacts", artifacts.stream()
                .map(this::toEvidenceArtifact)
                .toList());
        packet.put("collection_notes", List.of("Prototype EvidencePacket assembled from persisted runner callbacks."));
        return packet;
    }

    private Map<UUID, List<Observation>> groupObservationsByCheckpointId(List<Observation> observations) {
        Map<UUID, List<Observation>> grouped = new LinkedHashMap<>();
        for (Observation observation : observations) {
            grouped.computeIfAbsent(observation.getCheckpointId(), ignored -> new ArrayList<>()).add(observation);
        }
        return grouped;
    }

    private String latestCheckpointUrl(List<Checkpoint> checkpoints, URI fallbackUrl) {
        if (checkpoints.isEmpty()) {
            return fallbackUrl.toString();
        }

        Checkpoint latest = checkpoints.get(checkpoints.size() - 1);
        Object url = readJsonMap(latest.getStateJsonb()).get("url");
        return url == null ? fallbackUrl.toString() : url.toString();
    }

    private Map<String, Object> createScenario(RunResponse run) {
        Map<String, Object> scenario = new LinkedHashMap<>();
        String scenarioId = run.scenarioTemplateVersionId() == null
                ? "agent:" + run.id()
                : run.scenarioTemplateVersionId().toString();
        scenario.put("scenario_id", scenarioId);
        scenario.put("scenario_type", run.scenarioTemplateVersionId() == null ? "agent" : "template");
        scenario.put("goal", run.goal());
        scenario.put("plan_id", scenarioId);
        return scenario;
    }

    private Map<String, Object> createEnvironment(RunResponse run, List<Checkpoint> checkpoints) {
        Map<String, Object> environment = new LinkedHashMap<>();
        environment.put("device", run.devicePreset());
        environment.put("viewport", inferViewport(checkpoints));
        environment.put("locale", "ko-KR");
        environment.put("timezone", "Asia/Seoul");
        environment.put("auth_state", "anonymous");
        return environment;
    }

    private Object inferViewport(List<Checkpoint> checkpoints) {
        for (Checkpoint checkpoint : checkpoints) {
            Object viewport = readJsonMap(checkpoint.getStateJsonb()).get("viewport");
            if (viewport != null) {
                return viewport;
            }
        }
        return Map.of("width", 1440, "height", 900);
    }

    private Map<String, Object> toEvidenceCheckpoint(Checkpoint checkpoint, List<Observation> observations) {
        Map<String, Object> evidenceCheckpoint = new LinkedHashMap<>();
        evidenceCheckpoint.put("checkpoint_id", checkpoint.getCheckpointKey());
        evidenceCheckpoint.put("step_id", resolveStepId(checkpoint));
        evidenceCheckpoint.put("primaryStage", checkpoint.getStage());
        evidenceCheckpoint.put("trigger", readJsonMap(checkpoint.getTriggerJsonb()));
        evidenceCheckpoint.put("settle", readJsonMap(checkpoint.getSettleJsonb()));
        evidenceCheckpoint.put("state", readJsonMap(checkpoint.getStateJsonb()));
        evidenceCheckpoint.put("observations", observations.stream()
                .map(this::toEvidenceObservation)
                .toList());
        evidenceCheckpoint.put("deltas", readJsonList(checkpoint.getDeltaJsonb()));
        evidenceCheckpoint.put("artifact_refs", readJsonList(checkpoint.getArtifactRefsJsonb()));
        return evidenceCheckpoint;
    }

    private Map<String, Object> toEvidenceObservation(Observation observation) {
        Map<String, Object> evidenceObservation = new LinkedHashMap<>();
        evidenceObservation.put("observation_id", shortObservationId(observation.getObservationKey()));
        evidenceObservation.put("type", observation.getObservationType());
        evidenceObservation.put("stage", observation.getStage());
        evidenceObservation.put("source", readJsonList(observation.getSourcesJsonb()));
        evidenceObservation.put("data", readJsonMap(observation.getDataJsonb()));
        if (observation.getConfidence() != null) {
            evidenceObservation.put("confidence", observation.getConfidence());
        }
        return evidenceObservation;
    }

    private Map<String, Object> createAggregateSignals(
            List<Checkpoint> checkpoints,
            List<Observation> observations,
            List<Artifact> artifacts
    ) {
        Map<String, Object> signals = new LinkedHashMap<>();
        signals.put("checkpoint_count", checkpoints.size());
        signals.put("observation_count", observations.size());
        signals.put("artifact_count", artifacts.size());
        signals.put("task_success", taskSuccess(checkpoints));
        signals.put("cta_candidate_count", countObservations(observations, "cta_candidate"));
        signals.put("product_detail_signal_count", countObservations(observations, "product_detail_signal"));
        signals.put("goal_action_result_count", countObservations(observations, "goal_action_result"));
        signals.put("depth_from_discovery_count", countObservations(observations, "depth_from_discovery"));
        signals.put("console_error_count", consoleErrorCount(checkpoints, observations));
        signals.put("failed_request_count", failedRequestCount(checkpoints, observations));
        signals.put("network_failure_count", countObservations(observations, "network_failure"));
        Map<String, Long> primaryCtaCountByStage = primaryCtaCountByStage(observations);
        if (!primaryCtaCountByStage.isEmpty()) {
            signals.put("primary_cta_count_by_stage", primaryCtaCountByStage);
        }
        return signals;
    }

    private String resolveStepId(Checkpoint checkpoint) {
        if (checkpoint.getStepKey() != null && !checkpoint.getStepKey().isBlank()) {
            return checkpoint.getStepKey();
        }
        return checkpoint.getStepId() == null ? "unknown_step" : checkpoint.getStepId().toString();
    }

    private String shortObservationId(String observationKey) {
        if (observationKey == null || observationKey.isBlank()) {
            return observationKey;
        }
        int separatorIndex = observationKey.lastIndexOf('.');
        return separatorIndex < 0 ? observationKey : observationKey.substring(separatorIndex + 1);
    }

    private String taskSuccess(List<Checkpoint> checkpoints) {
        return checkpoints.isEmpty() ? "partial" : "success";
    }

    private long failedRequestCount(List<Checkpoint> checkpoints, List<Observation> observations) {
        long fromState = checkpoints.stream()
                .map(checkpoint -> readJsonMap(checkpoint.getStateJsonb()).get("network_summary"))
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .mapToLong(summary -> readLong(summary.get("failed_request_count")))
                .sum();
        return fromState + countObservations(observations, "network_failure");
    }

    private long consoleErrorCount(List<Checkpoint> checkpoints, List<Observation> observations) {
        long fromState = checkpoints.stream()
                .map(checkpoint -> readJsonMap(checkpoint.getStateJsonb()).get("console_summary"))
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .mapToLong(summary -> readLong(summary.get("error_count")))
                .sum();
        return fromState + countObservations(observations, "console_error");
    }

    private Map<String, Long> primaryCtaCountByStage(List<Observation> observations) {
        Map<String, Long> counts = new LinkedHashMap<>();
        observations.stream()
                .filter(observation -> "cta_candidate".equals(observation.getObservationType()) || "cta_cluster".equals(observation.getObservationType()))
                .forEach(observation -> counts.merge(observation.getStage(), 1L, Long::sum));
        return counts;
    }

    private long readLong(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private Map<String, Object> createDecisionStageSummary(List<Checkpoint> checkpoints, List<Observation> observations) {
        Map<String, Object> summary = new LinkedHashMap<>();
        for (String stage : List.of("FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT")) {
            List<String> checkpointIds = checkpoints.stream()
                    .filter(checkpoint -> stage.equals(checkpoint.getStage()))
                    .map(Checkpoint::getCheckpointKey)
                    .toList();
            long observationCount = observations.stream()
                    .filter(observation -> stage.equals(observation.getStage()))
                    .count();
            summary.put(stage, Map.of(
                    "status", checkpointIds.isEmpty() && observationCount == 0 ? "NOT_OBSERVED" : "OBSERVED",
                    "checkpointIds", checkpointIds,
                    "observationCount", observationCount
            ));
        }
        return summary;
    }

    private long countObservations(List<Observation> observations, String observationType) {
        return observations.stream()
                .filter(observation -> observationType.equals(observation.getObservationType()))
                .count();
    }

    private Map<String, Object> toEvidenceArtifact(Artifact artifact) {
        Map<String, Object> evidenceArtifact = new LinkedHashMap<>();
        evidenceArtifact.put("artifact_id", artifact.getId().toString());
        evidenceArtifact.put("type", toEvidenceArtifactType(artifact.getArtifactType()));
        evidenceArtifact.put("uri", ArtifactResponse.contentUrl(artifact));
        addSignedUrlIfAvailable(evidenceArtifact, artifact);
        evidenceArtifact.put("mime_type", artifact.getMimeType());
        evidenceArtifact.put("size_bytes", artifact.getSizeBytes());
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("bucket", artifact.getS3Bucket());
        metadata.put("key", artifact.getS3Key());
        metadata.put("width", artifact.getWidth());
        metadata.put("height", artifact.getHeight());
        evidenceArtifact.put("metadata", metadata);
        return evidenceArtifact;
    }

    private void addSignedUrlIfAvailable(Map<String, Object> evidenceArtifact, Artifact artifact) {
        if (artifactPresignedUrlGenerator == null || !isSignableImageArtifact(artifact)) {
            return;
        }

        try {
            URL signedUrl = artifactPresignedUrlGenerator.generateGetUrl(artifact, signedUrlTtl);
            if (signedUrl != null && isHttpUrl(signedUrl)) {
                evidenceArtifact.put("signed_url", signedUrl.toString());
            }
        } catch (RuntimeException ignored) {
            // Analyzer can still use the stable API content uri when S3 presigning is unavailable.
        }
    }

    private boolean isSignableImageArtifact(Artifact artifact) {
        ArtifactType artifactType = artifact.getArtifactType();
        if (artifactType != ArtifactType.SCREENSHOT && artifactType != ArtifactType.FRAME) {
            return false;
        }
        String mimeType = artifact.getMimeType();
        return mimeType != null && SIGNABLE_IMAGE_MIME_TYPES.contains(mimeType.toLowerCase());
    }

    private boolean isHttpUrl(URL url) {
        String protocol = url.getProtocol();
        return "https".equalsIgnoreCase(protocol) || "http".equalsIgnoreCase(protocol);
    }

    private String toEvidenceArtifactType(ArtifactType artifactType) {
        return switch (artifactType) {
            case SCREENSHOT -> "screenshot";
            case DOM_SNAPSHOT -> "dom_snapshot";
            case AX_TREE -> "ax_tree";
            case TRACE -> "trace";
            case HAR -> "har";
            case CONSOLE_LOG -> "console_log";
            case REPORT_PDF, REPORT_MARKDOWN, REPORT_HTML, REPORT_JSON -> "report";
            case FRAME -> "frame";
            case OTHER -> "other";
        };
    }

    Map<String, Object> readJsonMap(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return Map.of();
        }

        try {
            return objectMapper.readValue(rawJson, MAP_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored JSON object is invalid", exception);
        }
    }

    List<Object> readJsonList(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return List.of();
        }

        try {
            return objectMapper.readValue(rawJson, LIST_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored JSON array is invalid", exception);
        }
    }
}
