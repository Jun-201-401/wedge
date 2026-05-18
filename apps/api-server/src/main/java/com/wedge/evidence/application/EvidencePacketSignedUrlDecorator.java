package com.wedge.evidence.application;

import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import java.net.URL;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class EvidencePacketSignedUrlDecorator {
    private static final Logger log = LoggerFactory.getLogger(EvidencePacketSignedUrlDecorator.class);
    private static final Set<String> SIGNABLE_IMAGE_MIME_TYPES = Set.of(
            "image/png",
            "image/jpeg",
            "image/webp"
    );

    private final ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator;
    private final Duration signedUrlTtl;
    private final int maxSignedUrlCount;

    private record SignedUrlAttempt(boolean added, String failureReason) {
        static SignedUrlAttempt success() {
            return new SignedUrlAttempt(true, null);
        }

        static SignedUrlAttempt failed(String failureReason) {
            return new SignedUrlAttempt(false, failureReason);
        }
    }

    @Autowired
    public EvidencePacketSignedUrlDecorator(
            ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator,
            @Value("${wedge.artifacts.presigned-url.ttl-seconds:3600}") long signedUrlTtlSeconds,
            @Value("${wedge.artifacts.presigned-url.max-count:20}") int maxSignedUrlCount
    ) {
        this(
                artifactPresignedUrlGenerator,
                Duration.ofSeconds(signedUrlTtlSeconds),
                maxSignedUrlCount
        );
    }

    EvidencePacketSignedUrlDecorator(
            ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator,
            Duration signedUrlTtl,
            int maxSignedUrlCount
    ) {
        this.artifactPresignedUrlGenerator = artifactPresignedUrlGenerator;
        this.signedUrlTtl = signedUrlTtl;
        this.maxSignedUrlCount = maxSignedUrlCount;
    }

    public Map<String, Object> decorateRunPacket(Map<String, Object> packet, List<Artifact> artifacts) {
        if (packet == null || packet.isEmpty()) {
            return packet;
        }

        List<Artifact> sourceArtifacts = artifacts == null ? List.of() : artifacts;
        Map<UUID, Artifact> artifactsById = sourceArtifacts.stream()
                .filter(artifact -> artifact.getId() != null)
                .collect(Collectors.toMap(Artifact::getId, Function.identity(), (left, ignored) -> left));
        Set<String> referencedArtifactIds = referencedArtifactIds(packet);
        List<Object> decoratedArtifacts = new ArrayList<>();
        int signedUrlAttemptCount = 0;

        for (Object artifactItem : artifactItems(packet)) {
            if (!(artifactItem instanceof Map<?, ?> rawArtifact)) {
                decoratedArtifacts.add(artifactItem);
                continue;
            }

            Map<String, Object> decoratedArtifact = copyArtifact(rawArtifact);
            String artifactId = stringValue(decoratedArtifact.get("artifact_id"));
            decoratedArtifact.remove("signed_url");

            UUID parsedArtifactId = parseUuid(artifactId);
            Artifact artifact = parsedArtifactId == null ? null : artifactsById.get(parsedArtifactId);
            if (
                    artifact != null
                            && referencedArtifactIds.contains(artifactId)
                            && isSignableImageArtifact(artifact)
            ) {
                if (maxSignedUrlCount > 0 && signedUrlAttemptCount < maxSignedUrlCount) {
                    signedUrlAttemptCount++;
                    SignedUrlAttempt attempt = addSignedUrl(decoratedArtifact, artifact);
                    if (!attempt.added()) {
                        putSignedUrlDiagnostic(decoratedArtifact, "failed", attempt.failureReason());
                    }
                } else {
                    putSignedUrlDiagnostic(decoratedArtifact, "skipped", "max_signed_url_count_reached");
                }
            }
            decoratedArtifacts.add(decoratedArtifact);
        }

        Map<String, Object> decoratedPacket = new LinkedHashMap<>(packet);
        decoratedPacket.put("artifacts", decoratedArtifacts);
        return decoratedPacket;
    }

    private SignedUrlAttempt addSignedUrl(Map<String, Object> evidenceArtifact, Artifact artifact) {
        try {
            URL signedUrl = artifactPresignedUrlGenerator.generateGetUrl(artifact, signedUrlTtl);
            if (signedUrl != null && isHttpUrl(signedUrl)) {
                evidenceArtifact.put("signed_url", signedUrl.toString());
                return SignedUrlAttempt.success();
            }
            return SignedUrlAttempt.failed(signedUrl == null ? "presign_url_missing" : "presign_url_not_http");
        } catch (RuntimeException exception) {
            log.warn(
                    "Failed to add signed_url to evidence artifact. runId={}, artifactId={}, reason={}",
                    artifact.getRunId(),
                    artifact.getId(),
                    exception.toString()
            );
            return SignedUrlAttempt.failed("presign_failed");
        }
    }

    private Set<String> referencedArtifactIds(Map<String, Object> packet) {
        Set<String> referencedArtifactIds = new HashSet<>();
        Object checkpoints = packet.get("checkpoints");
        if (!(checkpoints instanceof List<?> checkpointItems)) {
            return referencedArtifactIds;
        }

        for (Object checkpointItem : checkpointItems) {
            if (!(checkpointItem instanceof Map<?, ?> checkpoint)) {
                continue;
            }
            Object artifactRefs = checkpoint.get("artifact_refs");
            if (!(artifactRefs instanceof List<?> refs)) {
                continue;
            }
            for (Object ref : refs) {
                String artifactId = normalizeArtifactRef(ref);
                if (!artifactId.isBlank()) {
                    referencedArtifactIds.add(artifactId);
                }
            }
        }
        return referencedArtifactIds;
    }

    private List<?> artifactItems(Map<String, Object> packet) {
        Object artifacts = packet.get("artifacts");
        return artifacts instanceof List<?> artifactItems ? artifactItems : List.of();
    }

    private Map<String, Object> copyArtifact(Map<?, ?> artifact) {
        Map<String, Object> copied = new LinkedHashMap<>();
        artifact.forEach((key, value) -> {
            if (key instanceof String stringKey) {
                copied.put(stringKey, value);
            }
        });
        return copied;
    }

    private void putSignedUrlDiagnostic(Map<String, Object> evidenceArtifact, String status, String reason) {
        Map<String, Object> metadata = copyMetadata(evidenceArtifact.get("metadata"));
        metadata.put("signed_url_status", status);
        metadata.put("signed_url_reason", reason);
        evidenceArtifact.put("metadata", metadata);
    }

    private Map<String, Object> copyMetadata(Object metadata) {
        Map<String, Object> copied = new LinkedHashMap<>();
        if (!(metadata instanceof Map<?, ?> rawMetadata)) {
            return copied;
        }
        rawMetadata.forEach((key, value) -> {
            if (key instanceof String stringKey) {
                copied.put(stringKey, value);
            }
        });
        return copied;
    }

    private String normalizeArtifactRef(Object value) {
        String artifactRef = stringValue(value);
        return artifactRef.startsWith("artifact:") ? artifactRef.substring("artifact:".length()) : artifactRef;
    }

    private String stringValue(Object value) {
        return value instanceof String text ? text : "";
    }

    private UUID parseUuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException exception) {
            return null;
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
}
