package com.wedge.discovery.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import com.wedge.evidence.application.CheckpointPersistenceService;
import com.wedge.evidence.application.command.SaveRunCheckpointsCommand;
import com.wedge.discovery.application.command.DiscoveryAcceptedCommand;
import com.wedge.discovery.application.command.DiscoveryFailedCommand;
import com.wedge.discovery.application.command.DiscoveryFinishedCommand;
import com.wedge.discovery.application.command.DiscoveryRecommendationCommand;
import com.wedge.discovery.application.command.DiscoverySummaryCommand;
import com.wedge.discovery.domain.DiscoveryStatus;
import com.wedge.discovery.domain.ScenarioRecommendation;
import com.wedge.discovery.domain.SiteDiscovery;
import com.wedge.discovery.infrastructure.ScenarioRecommendationMapper;
import com.wedge.discovery.infrastructure.SiteDiscoveryMapper;
import com.wedge.common.internal.InternalCallbackContext;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DiscoveryCallbackService {
    private static final String ACCEPTED_CONSUMER = "runner.discovery.accepted";
    private static final String CHECKPOINTS_CONSUMER = "runner.discovery.checkpoints";
    private static final String FINISHED_CONSUMER = "runner.discovery.finished";
    private static final String FAILED_CONSUMER = "runner.discovery.failed";

    private final DiscoveryService discoveryService;
    private final SiteDiscoveryMapper siteDiscoveryMapper;
    private final ScenarioRecommendationMapper scenarioRecommendationMapper;
    private final ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;
    private final CheckpointPersistenceService checkpointPersistenceService;
    private final ObjectMapper objectMapper;

    @Transactional
    public DiscoveryCallbackAckResponse handleAccepted(UUID discoveryId, DiscoveryAcceptedCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());
        DiscoveryCallbackAckResponse duplicateResponse = duplicateStatusResponse(ACCEPTED_CONSUMER, context.eventId(), discoveryId);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        SiteDiscovery discovery = discoveryService.findDiscovery(discoveryId);
        if (discovery.getStatus() == DiscoveryStatus.RUNNING) {
            return DiscoveryCallbackAckResponse.status(discoveryId, DiscoveryStatus.RUNNING);
        }
        if (discovery.getStatus() != DiscoveryStatus.QUEUED) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Discovery cannot be accepted from its current state.");
        }
        int updated = siteDiscoveryMapper.markRunning(discoveryId, command.acceptedAt());
        if (updated == 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Discovery state changed during accepted callback.");
        }
        return DiscoveryCallbackAckResponse.status(discoveryId, DiscoveryStatus.RUNNING);
    }

    @Transactional
    public DiscoveryCallbackAckResponse handleCheckpoints(UUID discoveryId, String workerId, SaveRunCheckpointsCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(workerId);

        if (isDuplicate(CHECKPOINTS_CONSUMER, context.eventId())) {
            discoveryService.findDiscovery(discoveryId);
            return DiscoveryCallbackAckResponse.duplicateCheckpoints(discoveryId, command.checkpoints().size());
        }

        discoveryService.findDiscovery(discoveryId);
        int checkpointCount = checkpointPersistenceService.saveDiscoveryCheckpoints(discoveryId, command);
        return DiscoveryCallbackAckResponse.checkpoints(discoveryId, checkpointCount);
    }

    @Transactional
    public DiscoveryCallbackAckResponse handleFinished(UUID discoveryId, DiscoveryFinishedCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());
        DiscoveryCallbackAckResponse duplicateResponse = duplicateStatusResponse(FINISHED_CONSUMER, context.eventId(), discoveryId);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        discoveryService.findDiscovery(discoveryId);
        int updated = siteDiscoveryMapper.markCompleted(
                discoveryId,
                command.finalUrl(),
                toJson(toSummaryMap(command.summary())),
                command.finishedAt()
        );
        if (updated == 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Discovery cannot be completed from its current state.");
        }
        scenarioRecommendationMapper.deleteByDiscoveryId(discoveryId);
        command.summary().scenarioRecommendations().forEach(recommendation ->
                scenarioRecommendationMapper.insert(toScenarioRecommendation(discoveryId, recommendation))
        );
        return DiscoveryCallbackAckResponse.status(discoveryId, DiscoveryStatus.COMPLETED);
    }

    @Transactional
    public DiscoveryCallbackAckResponse handleFailed(UUID discoveryId, DiscoveryFailedCommand command, InternalCallbackContext context) {
        context.validateRequired();
        context.validateWorkerMatches(command.workerId());
        DiscoveryCallbackAckResponse duplicateResponse = duplicateStatusResponse(FAILED_CONSUMER, context.eventId(), discoveryId);
        if (duplicateResponse != null) {
            return duplicateResponse;
        }

        discoveryService.findDiscovery(discoveryId);
        int updated = siteDiscoveryMapper.markFailed(discoveryId, command.failureCode(), command.failureMessage(), command.failedAt());
        if (updated == 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Discovery cannot be failed from its current state.");
        }
        return DiscoveryCallbackAckResponse.status(discoveryId, DiscoveryStatus.FAILED);
    }

    private DiscoveryCallbackAckResponse duplicateStatusResponse(String consumerName, String eventId, UUID discoveryId) {
        if (!isDuplicate(consumerName, eventId)) {
            return null;
        }
        return DiscoveryCallbackAckResponse.duplicate(discoveryId, discoveryService.findDiscovery(discoveryId).getStatus());
    }

    private boolean isDuplicate(String consumerName, String eventId) {
        return !processedMessagePersistenceAdapter.tryMarkProcessed(consumerName, eventId);
    }

    private ScenarioRecommendation toScenarioRecommendation(UUID discoveryId, DiscoveryRecommendationCommand command) {
        ScenarioRecommendation recommendation = new ScenarioRecommendation();
        recommendation.setId(UUID.randomUUID());
        recommendation.setDiscoveryId(discoveryId);
        recommendation.setScenarioType(command.scenarioType());
        recommendation.setRecommendationLevel(command.recommendationLevel());
        recommendation.setConfidence(command.confidence());
        recommendation.setReason(command.reason());
        recommendation.setEvidenceRefsJsonb(toJson(command.evidenceRefs() == null ? List.of() : command.evidenceRefs()));
        recommendation.setEvidenceSummaryJsonb(toJson(command.evidenceSummary() == null ? Map.of() : command.evidenceSummary()));
        recommendation.setSuggestedStartUrl(command.suggestedStartUrl());
        recommendation.setSuggestedTargetJsonb(toJson(command.suggestedTarget() == null ? Map.of() : command.suggestedTarget()));
        return recommendation;
    }

    private Map<String, Object> toSummaryMap(DiscoverySummaryCommand summary) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("detectedFlowTypes", summary.detectedFlowTypes() == null ? List.of() : summary.detectedFlowTypes());
        value.put("missingFlowTypes", summary.missingFlowTypes() == null ? List.of() : summary.missingFlowTypes());
        value.put("primaryCtaCount", summary.primaryCtaCount());
        value.put("formCandidateCount", summary.formCandidateCount());
        value.put("pricingEntrypointCount", summary.pricingEntrypointCount());
        value.put("checkoutEntrypointCount", summary.checkoutEntrypointCount());
        return value;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "Failed to serialize discovery callback payload.", null, exception);
        }
    }
}
