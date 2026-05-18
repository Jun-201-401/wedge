package com.wedge.scenarioauthoring.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import com.wedge.discovery.application.DiscoveryService;
import com.wedge.discovery.domain.ScenarioRecommendation;
import com.wedge.discovery.domain.SiteDiscovery;
import com.wedge.discovery.infrastructure.ScenarioRecommendationMapper;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringConfirmRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringConfirmResponse;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobCreateRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobResponse;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringProviderPolicyRequest;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringJob;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import com.wedge.scenarioauthoring.infrastructure.ScenarioAuthoringJobMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ScenarioAuthoringJobService {
    private static final List<String> DEFAULT_PROVIDER_ORDER = List.of("INTERNAL_LLM", "RULE_BASED");
    private static final List<String> SUPPORTED_PROVIDER_ORDER = List.of("INTERNAL_LLM", "RULE_BASED");
    private static final Set<String> SUPPORTED_PROVIDER_TYPES = Set.of("INTERNAL_LLM", "RULE_BASED");
    private static final Set<String> AUTHORABLE_SCENARIO_TYPES = Set.of("LANDING_CTA", "SIGNUP_LEAD_FORM", "PRICING", "PURCHASE_CHECKOUT", "CONTACT", "CONTENT_ONLY");
    private static final Set<String> AUTHORABLE_RECOMMENDATION_LEVELS = Set.of("HIGH", "MEDIUM");
    private static final BigDecimal MIN_AUTHORING_RECOMMENDATION_CONFIDENCE = new BigDecimal("0.55");
    private static final int DEFAULT_TIMEOUT_MS = 45_000;
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 160;

    private final ScenarioAuthoringJobMapper scenarioAuthoringJobMapper;
    private final DiscoveryService discoveryService;
    private final ScenarioRecommendationMapper scenarioRecommendationMapper;
    private final ProjectAccessService projectAccessService;
    private final ObjectMapper objectMapper;
    private final ScenarioAuthoringExecuteRequestMessageFactory messageFactory;
    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final ApplicationEventPublisher applicationEventPublisher;

    @Transactional
    public ScenarioAuthoringJobResponse createJob(ScenarioAuthoringJobCreateRequest request, UUID userId, String idempotencyKey) {
        projectAccessService.ensureProjectAccessible(request.projectId(), userId);
        SiteDiscovery discovery = discoveryService.findDiscovery(request.sourceDiscoveryId());
        if (!request.projectId().equals(discovery.getProjectId())) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "Selected Discovery recommendation was not found.");
        }
        String normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
        if (normalizedIdempotencyKey != null) {
            ScenarioAuthoringJob existing = scenarioAuthoringJobMapper.findByIdempotencyKey(request.projectId(), userId, normalizedIdempotencyKey)
                    .orElse(null);
            if (existing != null) {
                return toResponse(existing);
            }
        }

        Map<String, Object> selectedRecommendation = selectPersistedRecommendation(request, discovery);
        Map<String, Object> input = buildInput(request, discovery, selectedRecommendation);
        Map<String, Object> providerPolicy = buildProviderPolicy(request.providerPolicy());
        ScenarioAuthoringJob job = buildQueuedRunnerAuthoringJob(request, discovery, input, providerPolicy, selectedRecommendation, userId, normalizedIdempotencyKey);
        try {
            scenarioAuthoringJobMapper.insert(job);
        } catch (DuplicateKeyException exception) {
            if (normalizedIdempotencyKey == null) {
                throw exception;
            }
            return scenarioAuthoringJobMapper.findByIdempotencyKey(request.projectId(), userId, normalizedIdempotencyKey)
                    .map(this::toResponse)
                    .orElseThrow(() -> exception);
        }
        ScenarioAuthoringExecuteRequestMessage message = messageFactory.create(job, request.requestedGoal(), input, providerPolicy);
        UUID outboxMessageId = outboxMessagePersistenceAdapter.appendScenarioAuthoringExecuteMessage(message, job.getId());
        applicationEventPublisher.publishEvent(new ScenarioAuthoringExecuteOutboxEnqueuedEvent(outboxMessageId));
        return toResponse(job);
    }

    @Transactional(readOnly = true)
    public ScenarioAuthoringJobResponse getJob(UUID authoringJobId, UUID userId) {
        ScenarioAuthoringJob job = findAccessibleJob(authoringJobId, userId);
        return toResponse(job);
    }

    @Transactional
    public ScenarioAuthoringConfirmResponse confirmCandidate(UUID authoringJobId, ScenarioAuthoringConfirmRequest request, UUID userId) {
        ScenarioAuthoringJob job = findAccessibleJob(authoringJobId, userId);
        List<Map<String, Object>> candidates = readList(job.getCandidatesJsonb());
        Map<String, Object> candidate = candidates.stream()
                .filter(item -> request.candidateId().equals(String.valueOf(item.get("candidate_id"))))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.VALIDATION_FAILED, "ScenarioAuthoring candidate was not found."));
        requireCandidateValidationPassed(candidate);
        if (job.getConfirmedCandidateId() != null && job.getConfirmedCandidateId().equals(request.candidateId())) {
            return new ScenarioAuthoringConfirmResponse(toResponse(job), candidate);
        }
        if (job.getStatus() != ScenarioAuthoringStatus.SUCCEEDED) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Only SUCCEEDED ScenarioAuthoring jobs can be confirmed.");
        }
        if (job.getExpiresAt() != null && !job.getExpiresAt().isAfter(OffsetDateTime.now())) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring job is expired.");
        }
        if (job.getConfirmedCandidateId() != null) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring job already confirmed a different candidate.");
        }
        if (scenarioAuthoringJobMapper.confirmCandidate(authoringJobId, request.candidateId(), userId) == 0) {
            ScenarioAuthoringJob current = findAccessibleJob(authoringJobId, userId);
            if (request.candidateId().equals(current.getConfirmedCandidateId())) {
                return new ScenarioAuthoringConfirmResponse(toResponse(current), candidate);
            }
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "ScenarioAuthoring candidate confirmation conflicted.");
        }
        job.setConfirmedCandidateId(request.candidateId());
        job.setConfirmedBy(userId);
        job.setConfirmedAt(OffsetDateTime.now());
        return new ScenarioAuthoringConfirmResponse(toResponse(job), candidate);
    }

    private ScenarioAuthoringJob buildQueuedRunnerAuthoringJob(
            ScenarioAuthoringJobCreateRequest request,
            SiteDiscovery discovery,
            Map<String, Object> input,
            Map<String, Object> providerPolicy,
            Map<String, Object> selectedRecommendation,
            UUID userId,
            String idempotencyKey
    ) {
        UUID jobId = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        ScenarioAuthoringJob job = new ScenarioAuthoringJob();
        job.setId(jobId);
        job.setProjectId(request.projectId());
        job.setSourceDiscoveryId(discovery.getId());
        job.setCorrelationId(UUID.randomUUID().toString());
        job.setIdempotencyKey(idempotencyKey);
        job.setStatus(ScenarioAuthoringStatus.QUEUED);
        job.setInputJsonb(toJson(input));
        job.setProviderPolicyJsonb(toJson(providerPolicy));
        job.setProviderTraceJsonb("[]");
        job.setCandidatesJsonb("[]");
        job.setValidationJsonb(toJson(pendingValidation()));
        job.setProvenanceJsonb(toJson(provenance(discovery, request, selectedRecommendation)));
        job.setFailureJsonb("null");
        job.setCreatedBy(userId);
        job.setCreatedAt(now);
        job.setUpdatedAt(now);
        job.setExpiresAt(now.plusMinutes(30));
        return job;
    }

    private Map<String, Object> buildInput(ScenarioAuthoringJobCreateRequest request, SiteDiscovery discovery, Map<String, Object> selectedRecommendation) {
        Map<String, Object> environment = Map.of(
                "device", discovery.getDevicePreset(),
                "viewport", readMap(discovery.getViewportJsonb()),
                "locale", "ko-KR",
                "timezone", "Asia/Seoul",
                "auth_state", "anonymous"
        );
        Map<String, Object> siteDiscoveryResult = Map.of(
                "schema_version", "0.5",
                "discovery_id", discovery.getId().toString(),
                "input_url", discovery.getInputUrl(),
                "final_url", discovery.getFinalUrl() == null ? discovery.getInputUrl() : discovery.getFinalUrl(),
                "environment", environment,
                "checkpoints", List.of(),
                "detected_flow_types", readStringList(readMap(discovery.getSummaryJsonb()).get("detectedFlowTypes")),
                "missing_flow_types", readStringList(readMap(discovery.getSummaryJsonb()).get("missingFlowTypes")),
                "scenario_recommendations", List.of(selectedRecommendation)
        );
        return Map.of(
                "site_discovery_result", siteDiscoveryResult,
                "requested_goal", request.requestedGoal(),
                "preferred_scenario_type", String.valueOf(selectedRecommendation.get("scenario_type")),
                "selected_recommendation", selectedRecommendation,
                "constraints", request.constraints() == null ? Map.of() : request.constraints(),
                "environment", environment,
                "safety", Map.of(
                        "allow_external_navigation", false,
                        "allow_payment_commit", false,
                        "allow_destructive_action", false,
                        "use_synthetic_inputs", true,
                        "stop_before_real_payment", true
                )
        );
    }

    private Map<String, Object> selectPersistedRecommendation(ScenarioAuthoringJobCreateRequest request, SiteDiscovery discovery) {
        String requestedScenarioType = requestedScenarioType(request);
        List<ScenarioRecommendation> recommendations = scenarioRecommendationMapper.findByDiscoveryId(discovery.getId());
        UUID selectedRecommendationId = selectedRecommendationId(request);
        ScenarioRecommendation recommendation;
        if (selectedRecommendationId != null) {
            recommendation = recommendations.stream()
                    .filter(item -> selectedRecommendationId.equals(item.getId()))
                    .findFirst()
                    .orElseThrow(() -> new BusinessException(ErrorCode.VALIDATION_FAILED, "Selected Discovery recommendation was not found."));
            requireAuthorableScenarioType(recommendation.getScenarioType());
            if (requestedScenarioType != null && !requestedScenarioType.equals(recommendation.getScenarioType())) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "selectedRecommendationId does not match preferredScenarioType.");
            }
        } else {
            String scenarioType = requestedScenarioType == null ? "LANDING_CTA" : requestedScenarioType;
            recommendation = recommendations.stream()
                    .filter(item -> scenarioType.equals(item.getScenarioType()))
                    .findFirst()
                    .orElse(null);
            if (recommendation == null) {
                return manualSelectedRecommendation(request, discovery, scenarioType);
            }
        }
        String suggestedStartUrl = recommendation.getSuggestedStartUrl();
        if (suggestedStartUrl == null || suggestedStartUrl.isBlank()) {
            suggestedStartUrl = discovery.getInputUrl();
        }
        List<String> evidenceRefs = readStringList(recommendation.getEvidenceRefsJsonb());
        if (request.selectedRecommendation() == null || selectedRecommendationId != null) {
            requireAuthorableRecommendation(recommendation, evidenceRefs);
        }
        return persistedRecommendationMap(recommendation, suggestedStartUrl, evidenceRefs);
    }

    private Map<String, Object> persistedRecommendationMap(ScenarioRecommendation recommendation, String suggestedStartUrl, List<String> evidenceRefs) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("recommendation_id", recommendation.getId().toString());
        value.put("scenario_type", recommendation.getScenarioType());
        value.put("recommendation_level", recommendation.getRecommendationLevel());
        value.put("confidence", recommendation.getConfidence());
        value.put("reason", recommendation.getReason());
        value.put("evidence_refs", evidenceRefs);
        value.put("evidence_summary", readMap(recommendation.getEvidenceSummaryJsonb()));
        value.put("suggested_start_url", suggestedStartUrl);
        value.put("suggested_target", readMap(recommendation.getSuggestedTargetJsonb()));
        return value;
    }

    private Map<String, Object> manualSelectedRecommendation(ScenarioAuthoringJobCreateRequest request, SiteDiscovery discovery, String scenarioType) {
        Map<String, Object> selected = request.selectedRecommendation() == null ? Map.of() : request.selectedRecommendation();
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("recommendation_id", discovery.getId() + ".manual." + scenarioType);
        value.put("scenario_type", scenarioType);
        value.put("recommendation_level", stringValue(selected.get("recommendationLevel"), "LOW"));
        value.put("confidence", selected.getOrDefault("confidence", BigDecimal.ZERO));
        value.put("reason", stringValue(selected.get("evidence"), "Manual scenario selection from create-analysis."));
        value.put("evidence_refs", readStringList(selected.get("evidenceRefs")));
        value.put("evidence_summary", mapValue(selected.get("evidenceSummary")));
        value.put("suggested_start_url", stringValue(selected.get("suggestedStartUrl"), discovery.getInputUrl()));
        value.put("suggested_target", mapValue(selected.get("suggestedTarget")));
        return value;
    }


    private String stringValue(Object value, String fallback) {
        return value instanceof String text && !text.isBlank() ? text : fallback;
    }

    private Map<String, Object> mapValue(Object value) {
        if (value instanceof Map<?, ?> rawMap) {
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) rawMap;
            return map;
        }
        return Map.of();
    }

    private void requireAuthorableRecommendation(ScenarioRecommendation recommendation, List<String> evidenceRefs) {
        if (!AUTHORABLE_RECOMMENDATION_LEVELS.contains(recommendation.getRecommendationLevel())) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "ScenarioAuthoring requires a HIGH or MEDIUM Discovery recommendation.");
        }
        if (recommendation.getConfidence() == null || recommendation.getConfidence().compareTo(MIN_AUTHORING_RECOMMENDATION_CONFIDENCE) < 0) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "ScenarioAuthoring requires a Discovery recommendation above the minimum confidence threshold.");
        }
        if (evidenceRefs.isEmpty()) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "ScenarioAuthoring requires Discovery recommendation evidence.");
        }
    }

    private String requestedScenarioType(ScenarioAuthoringJobCreateRequest request) {
        if (request.preferredScenarioType() != null && !request.preferredScenarioType().isBlank()) {
            return requireAuthorableScenarioType(request.preferredScenarioType());
        }
        Map<String, Object> selected = request.selectedRecommendation() == null ? Map.of() : request.selectedRecommendation();
        Object scenarioType = selected.getOrDefault("scenarioType", selected.get("scenario_type"));
        return scenarioType instanceof String text && !text.isBlank() ? requireAuthorableScenarioType(text) : null;
    }

    private UUID selectedRecommendationId(ScenarioAuthoringJobCreateRequest request) {
        if (request.selectedRecommendationId() != null) {
            return request.selectedRecommendationId();
        }
        Map<String, Object> selected = request.selectedRecommendation() == null ? Map.of() : request.selectedRecommendation();
        Object rawId = selected.getOrDefault("recommendationId", selected.get("recommendation_id"));
        if (rawId == null) {
            return null;
        }
        try {
            return UUID.fromString(String.valueOf(rawId));
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "selectedRecommendationId must be a UUID.");
        }
    }

    private String requireAuthorableScenarioType(String scenarioType) {
        if (AUTHORABLE_SCENARIO_TYPES.contains(scenarioType)) {
            return scenarioType;
        }
        throw new BusinessException(ErrorCode.VALIDATION_FAILED, "ScenarioAuthoring does not support scenario type: " + scenarioType);
    }

    private Map<String, Object> buildProviderPolicy(ScenarioAuthoringProviderPolicyRequest requestPolicy) {
        List<String> providerOrder = requestPolicy == null || requestPolicy.providerOrder() == null || requestPolicy.providerOrder().isEmpty()
                ? DEFAULT_PROVIDER_ORDER
                : requestPolicy.providerOrder();
        if (providerOrder.stream().anyMatch(provider -> !SUPPORTED_PROVIDER_TYPES.contains(provider))) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "ScenarioAuthoring providerPolicy supports only INTERNAL_LLM and RULE_BASED providers.");
        }
        if (providerOrder.stream().distinct().count() != providerOrder.size()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "ScenarioAuthoring providerPolicy.providerOrder must not contain duplicates.");
        }
        int timeoutMs = requestPolicy == null || requestPolicy.timeoutMs() == null ? DEFAULT_TIMEOUT_MS : requestPolicy.timeoutMs();
        if (timeoutMs < 1000) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "providerPolicy.timeoutMs must be at least 1000.");
        }
        return Map.of(
                "allowed_provider_types", SUPPORTED_PROVIDER_ORDER,
                "provider_order", providerOrder,
                "timeout_ms", timeoutMs,
                "fallback_allowed", requestPolicy == null || requestPolicy.fallbackAllowed() == null || requestPolicy.fallbackAllowed(),
                "approval_required", requestPolicy == null || requestPolicy.approvalRequired() == null || requestPolicy.approvalRequired(),
                "max_attempts", 1
        );
    }

    private Map<String, Object> pendingValidation() {
        return Map.of(
                "schema_valid", false,
                "safety_valid", false,
                "fit_requirements_valid", false,
                "errors", List.of(),
                "warnings", List.of(Map.of("code", "authoring_pending", "message", "ScenarioPlan candidate generation is queued on Runner."))
        );
    }

    private void requireCandidateValidationPassed(Map<String, Object> candidate) {
        if (!candidateValidationPassed(candidate)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "ScenarioAuthoring candidate failed validation.");
        }
    }

    private boolean candidateValidationPassed(Map<String, Object> candidate) {
        Map<String, Object> validation = candidateValidation(candidate);
        return booleanValue(validation.get("schema_valid"))
                && booleanValue(validation.get("safety_valid"))
                && booleanValue(validation.get("fit_requirements_valid"))
                && readObjectList(validation.get("errors")).isEmpty();
    }

    private Map<String, Object> candidateValidation(Map<String, Object> candidate) {
        Object validation = candidate.get("validation");
        if (validation instanceof Map<?, ?> rawMap) {
            @SuppressWarnings("unchecked")
            Map<String, Object> validationMap = (Map<String, Object>) rawMap;
            return validationMap;
        }
        return Map.of("schema_valid", false, "safety_valid", false, "fit_requirements_valid", false, "errors", List.of(Map.of("code", "candidate_validation_missing", "message", "ScenarioAuthoring candidate validation is missing.")), "warnings", List.of());
    }

    private boolean booleanValue(Object value) {
        return value instanceof Boolean booleanValue && booleanValue;
    }

    private Map<String, Object> provenance(SiteDiscovery discovery, ScenarioAuthoringJobCreateRequest request, Map<String, Object> selectedRecommendation) {
        String scenarioType = String.valueOf(selectedRecommendation.getOrDefault("scenarioType", selectedRecommendation.getOrDefault("scenario_type", "LANDING_CTA")));
        return Map.of(
                "source_discovery_id", discovery.getId().toString(),
                "source_recommendation_refs", List.of(discovery.getId() + ".recommendation." + scenarioType),
                "source_evidence_refs", readStringList(selectedRecommendation.getOrDefault("evidenceRefs", selectedRecommendation.get("evidence_refs"))),
                "prompt_version", "",
                "input_summary", request.requestedGoal(),
                "generated_at", OffsetDateTime.now().toString()
        );
    }

    private ScenarioAuthoringJob findJob(UUID id) {
        return scenarioAuthoringJobMapper.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.SCENARIO_AUTHORING_JOB_NOT_FOUND));
    }

    private ScenarioAuthoringJob findAccessibleJob(UUID id, UUID userId) {
        ScenarioAuthoringJob job = findJob(id);
        if (!projectAccessService.isProjectMember(job.getProjectId(), userId)) {
            throw new BusinessException(ErrorCode.SCENARIO_AUTHORING_JOB_NOT_FOUND);
        }
        return job;
    }

    private ScenarioAuthoringJobResponse toResponse(ScenarioAuthoringJob job) {
        Map<String, Object> providerPolicy = readMap(job.getProviderPolicyJsonb());
        List<Map<String, Object>> candidates = readList(job.getCandidatesJsonb());
        return new ScenarioAuthoringJobResponse(
                "0.5",
                job.getId(),
                job.getStatus(),
                job.getProjectId(),
                job.getSourceDiscoveryId(),
                job.getCorrelationId(),
                candidates.size(),
                readStringList(providerPolicy.get("provider_order")),
                readMap(job.getInputJsonb()),
                providerPolicy,
                readList(job.getProviderTraceJsonb()),
                candidates,
                readMap(job.getValidationJsonb()),
                readMap(job.getProvenanceJsonb()),
                readNullableMap(job.getFailureJsonb()),
                job.getConfirmedCandidateId(),
                job.getConfirmedBy(),
                job.getConfirmedAt(),
                job.getMaterializedRunId(),
                job.getCreatedAt(),
                job.getUpdatedAt(),
                job.getExpiresAt()
        );
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

    private Map<String, Object> readMap(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(rawJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to deserialize scenario authoring map payload.", null, exception);
        }
    }

    private Map<String, Object> readNullableMap(String rawJson) {
        if (rawJson == null || rawJson.isBlank() || "null".equals(rawJson)) {
            return null;
        }
        return readMap(rawJson);
    }

    private List<Map<String, Object>> readList(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(rawJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to deserialize scenario authoring list payload.", null, exception);
        }
    }

    private List<String> readStringList(Object value) {
        if (value instanceof String rawJson && !rawJson.isBlank()) {
            try {
                return objectMapper.readValue(rawJson, new TypeReference<>() {});
            } catch (JsonProcessingException exception) {
                throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to deserialize scenario authoring string list payload.", null, exception);
            }
        }
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        return List.of();
    }

    private List<Object> readObjectList(Object value) {
        if (value instanceof List<?> list) {
            return List.copyOf(list);
        }
        return List.of();
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to serialize scenario authoring payload.", null, exception);
        }
    }
}
