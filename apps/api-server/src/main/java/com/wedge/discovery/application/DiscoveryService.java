package com.wedge.discovery.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import com.wedge.discovery.api.dto.CreateDiscoveryRequest;
import com.wedge.discovery.api.dto.DiscoveryResponse;
import com.wedge.discovery.api.dto.DiscoverySummaryResponse;
import com.wedge.discovery.api.dto.ScenarioRecommendationResponse;
import com.wedge.discovery.domain.DiscoveryStatus;
import com.wedge.discovery.domain.ScenarioRecommendation;
import com.wedge.discovery.domain.SiteDiscovery;
import com.wedge.discovery.infrastructure.ScenarioRecommendationMapper;
import com.wedge.discovery.infrastructure.SiteDiscoveryMapper;
import com.wedge.project.application.DefaultProjectService;
import com.wedge.project.application.ProjectAccessService;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DiscoveryService {
    private static final List<String> DEVICE_PRESETS = List.of("desktop", "tablet", "mobile");
    private static final String EMPTY_JSON_OBJECT = "{}";
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 160;

    private final SiteDiscoveryMapper siteDiscoveryMapper;
    private final ScenarioRecommendationMapper scenarioRecommendationMapper;
    private final ObjectMapper objectMapper;
    private final DiscoveryExecuteRequestMessageFactory messageFactory;
    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final ApplicationEventPublisher applicationEventPublisher;
    private final ProjectAccessService projectAccessService;
    private final DefaultProjectService defaultProjectService;
    private final DiscoveryUrlValidator discoveryUrlValidator;

    @Transactional
    public DiscoveryResponse createDiscovery(CreateDiscoveryRequest request, UUID userId, String idempotencyKey) {
        validate(request);
        UUID projectId = resolveProjectId(request, userId);
        String normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
        if (normalizedIdempotencyKey != null) {
            SiteDiscovery existing = siteDiscoveryMapper.findByIdempotencyKey(projectId, userId, normalizedIdempotencyKey)
                    .orElse(null);
            if (existing != null) {
                return toIdempotentReplayResponse(existing, request);
            }
        }

        SiteDiscovery discovery = toQueuedDiscovery(request, userId, projectId, normalizedIdempotencyKey);
        try {
            siteDiscoveryMapper.insert(discovery);
        } catch (DuplicateKeyException exception) {
            if (normalizedIdempotencyKey == null) {
                throw exception;
            }
            SiteDiscovery existing = siteDiscoveryMapper.findByIdempotencyKey(projectId, userId, normalizedIdempotencyKey)
                    .orElseThrow(() -> exception);
            return toIdempotentReplayResponse(existing, request);
        }
        DiscoveryExecuteRequestMessage message = messageFactory.create(discovery, request);
        UUID outboxMessageId = outboxMessagePersistenceAdapter.appendDiscoveryExecuteMessage(message, discovery.getId());
        applicationEventPublisher.publishEvent(new DiscoveryExecuteOutboxEnqueuedEvent(outboxMessageId));
        return toResponse(discovery, List.of());
    }

    @Transactional(readOnly = true)
    public DiscoveryResponse getDiscovery(UUID discoveryId, UUID userId) {
        SiteDiscovery discovery = findDiscovery(discoveryId);
        projectAccessService.ensureProjectAccessible(discovery.getProjectId(), userId);
        return toResponse(discovery, scenarioRecommendationMapper.findByDiscoveryId(discoveryId));
    }

    public SiteDiscovery findDiscovery(UUID discoveryId) {
        return siteDiscoveryMapper.findById(discoveryId)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery was not found."));
    }

    private UUID resolveProjectId(CreateDiscoveryRequest request, UUID userId) {
        if (request.projectId() != null) {
            projectAccessService.ensureProjectAccessible(request.projectId(), userId);
            return request.projectId();
        }
        return defaultProjectService.resolveDefaultProject(userId, request.url());
    }

    private SiteDiscovery toQueuedDiscovery(CreateDiscoveryRequest request, UUID userId, UUID projectId, String idempotencyKey) {
        SiteDiscovery discovery = new SiteDiscovery();
        discovery.setId(UUID.randomUUID());
        discovery.setProjectId(projectId);
        discovery.setInputUrl(request.url().toString());
        discovery.setDevicePreset(request.devicePreset());
        discovery.setViewportJsonb(toJson(Map.of(
                "width", request.viewport() == null ? messageFactory.defaultWidth(request.devicePreset()) : request.viewport().width(),
                "height", request.viewport() == null ? messageFactory.defaultHeight(request.devicePreset()) : request.viewport().height()
        )));
        discovery.setStatus(DiscoveryStatus.QUEUED);
        discovery.setSummaryJsonb(EMPTY_JSON_OBJECT);
        discovery.setCreatedBy(userId);
        discovery.setIdempotencyKey(idempotencyKey);
        return discovery;
    }

    private DiscoveryResponse toIdempotentReplayResponse(SiteDiscovery existing, CreateDiscoveryRequest request) {
        requireSameDiscoveryRequest(existing, request);
        return toResponse(existing, scenarioRecommendationMapper.findByDiscoveryId(existing.getId()));
    }

    private void requireSameDiscoveryRequest(SiteDiscovery existing, CreateDiscoveryRequest request) {
        if (
                !Objects.equals(existing.getInputUrl(), request.url().toString())
                        || !Objects.equals(existing.getDevicePreset(), request.devicePreset())
                        || !readMap(existing.getViewportJsonb()).equals(toViewportMap(request))
        ) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Idempotency-Key was reused with a different discovery request.");
        }
    }

    private Map<String, Object> toViewportMap(CreateDiscoveryRequest request) {
        return Map.of(
                "width", request.viewport() == null ? messageFactory.defaultWidth(request.devicePreset()) : request.viewport().width(),
                "height", request.viewport() == null ? messageFactory.defaultHeight(request.devicePreset()) : request.viewport().height()
        );
    }

    private DiscoveryResponse toResponse(SiteDiscovery discovery, List<ScenarioRecommendation> recommendations) {
        return new DiscoveryResponse(
                discovery.getId(),
                discovery.getProjectId(),
                discovery.getStatus(),
                URI.create(discovery.getInputUrl()),
                discovery.getFinalUrl() == null ? null : URI.create(discovery.getFinalUrl()),
                readSummary(discovery.getSummaryJsonb()),
                recommendations.stream().map(this::toRecommendationResponse).toList(),
                discovery.getCreatedAt(),
                discovery.getFinishedAt(),
                discovery.getFailureCode(),
                discovery.getFailureMessage()
        );
    }

    private ScenarioRecommendationResponse toRecommendationResponse(ScenarioRecommendation recommendation) {
        return new ScenarioRecommendationResponse(
                recommendation.getId(),
                recommendation.getScenarioType(),
                recommendation.getRecommendationLevel(),
                recommendation.getConfidence(),
                recommendation.getReason(),
                readStringList(recommendation.getEvidenceRefsJsonb()),
                readMap(recommendation.getEvidenceSummaryJsonb()),
                recommendation.getSuggestedStartUrl() == null ? null : URI.create(recommendation.getSuggestedStartUrl()),
                readMap(recommendation.getSuggestedTargetJsonb())
        );
    }

    private void validate(CreateDiscoveryRequest request) {
        if (!DEVICE_PRESETS.contains(request.devicePreset())) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Unsupported discovery devicePreset: " + request.devicePreset());
        }
        discoveryUrlValidator.validate(request.url());
    }

    private String normalizeIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return null;
        }
        String normalized = idempotencyKey.trim();
        if (normalized.length() > MAX_IDEMPOTENCY_KEY_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Idempotency-Key is too long.");
        }
        return normalized;
    }

    private DiscoverySummaryResponse readSummary(String rawJson) {
        Map<String, Object> summary = readMap(rawJson);
        if (summary.isEmpty()) {
            return DiscoverySummaryResponse.empty();
        }
        return new DiscoverySummaryResponse(
                readStringList(summary.get("detectedFlowTypes")),
                readStringList(summary.get("missingFlowTypes")),
                readInt(summary.get("primaryCtaCount")),
                readInt(summary.get("formCandidateCount")),
                readInt(summary.get("pricingEntrypointCount")),
                readInt(summary.get("checkoutEntrypointCount"))
        );
    }

    private List<String> readStringList(String rawJson) {
        try {
            return rawJson == null ? List.of() : objectMapper.readValue(rawJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to deserialize discovery list payload.", null, exception);
        }
    }

    private List<String> readStringList(Object value) {
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }

    private Map<String, Object> readMap(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(rawJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to deserialize discovery map payload.", null, exception);
        }
    }

    private int readInt(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return 0;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to serialize discovery payload.", null, exception);
        }
    }
}
