package com.wedge.scenarioauthoring.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import com.wedge.discovery.application.DiscoveryService;
import com.wedge.discovery.domain.ScenarioRecommendation;
import com.wedge.discovery.domain.SiteDiscovery;
import com.wedge.discovery.infrastructure.ScenarioRecommendationMapper;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringConfirmRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobCreateRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobResponse;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringProviderPolicyRequest;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringJob;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import com.wedge.scenarioauthoring.infrastructure.ScenarioAuthoringJobMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ScenarioAuthoringJobServiceTest {
    private static final UUID PROJECT_ID = UUID.fromString("8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923");
    private static final UUID DISCOVERY_ID = UUID.fromString("20000000-0000-4000-8000-000000000011");
    private static final UUID USER_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID RECOMMENDATION_ID = UUID.fromString("30000000-0000-4000-8000-000000000011");
    private static final UUID PRICING_RECOMMENDATION_ID = UUID.fromString("30000000-0000-4000-8000-000000000022");

    @Mock
    private ScenarioAuthoringJobMapper scenarioAuthoringJobMapper;

    @Mock
    private DiscoveryService discoveryService;

    @Mock
    private ScenarioRecommendationMapper scenarioRecommendationMapper;

    @Mock
    private ProjectAccessService projectAccessService;

    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    private ScenarioAuthoringJobService service;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new ScenarioAuthoringJobService(
                scenarioAuthoringJobMapper,
                discoveryService,
                scenarioRecommendationMapper,
                projectAccessService,
                objectMapper,
                new ScenarioAuthoringExecuteRequestMessageFactory(),
                outboxMessagePersistenceAdapter,
                applicationEventPublisher
        );
        lenient().when(outboxMessagePersistenceAdapter.appendScenarioAuthoringExecuteMessage(any(), any()))
                .thenReturn(UUID.fromString("40000000-0000-4000-8000-000000000001"));
    }

    @Test
    void createJobQueuesRunnerAuthoringRequest() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation()));

        ScenarioAuthoringJobResponse response = service.createJob(createRequest(), USER_ID, "idem-authoring-1");

        assertThat(response.status()).isEqualTo(ScenarioAuthoringStatus.QUEUED);
        assertThat(response.candidateCount()).isZero();
        assertThat(response.providerOrder()).containsExactly("RULE_BASED");
        assertThat(response.validation().get("schema_valid")).isEqualTo(false);

        ArgumentCaptor<ScenarioAuthoringJob> jobCaptor = ArgumentCaptor.forClass(ScenarioAuthoringJob.class);
        verify(scenarioAuthoringJobMapper).insert(jobCaptor.capture());
        ScenarioAuthoringJob persisted = jobCaptor.getValue();
        assertThat(persisted.getStatus()).isEqualTo(ScenarioAuthoringStatus.QUEUED);
        assertThat(persisted.getProviderTraceJsonb()).isEqualTo("[]");
        assertThat(persisted.getCandidatesJsonb()).isEqualTo("[]");
        verify(outboxMessagePersistenceAdapter).appendScenarioAuthoringExecuteMessage(any(), eq(persisted.getId()));
        verify(projectAccessService).ensureProjectAccessible(PROJECT_ID, USER_ID);
    }

    @Test
    void createJobDefaultsProviderOrderToInternalLlmThenRuleBased() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation()));
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "무료 체험 CTA까지의 흐름 점검",
                "LANDING_CTA",
                Map.of("scenarioType", "LANDING_CTA"),
                Map.of(),
                null
        );

        ScenarioAuthoringJobResponse response = service.createJob(request, USER_ID, null);

        assertThat(response.providerOrder()).containsExactly("INTERNAL_LLM", "RULE_BASED");
        @SuppressWarnings("unchecked")
        List<String> allowedProviders = (List<String>) response.providerPolicy().get("allowed_provider_types");
        assertThat(allowedProviders).containsExactly("INTERNAL_LLM", "RULE_BASED");
    }

    @Test
    void createJobIgnoresForgedRecommendationUrlAndUsesPersistedRecommendation() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation()));
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "무료 체험 CTA까지의 흐름 점검",
                "LANDING_CTA",
                Map.of(
                        "scenarioType", "LANDING_CTA",
                        "suggestedStartUrl", "https://attacker.example/phishing",
                        "evidenceRefs", List.of("forged.obs")
                ),
                Map.of(),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );

        ScenarioAuthoringJobResponse response = service.createJob(request, USER_ID, null);

        @SuppressWarnings("unchecked")
        Map<String, Object> selectedRecommendation = (Map<String, Object>) response.input().get("selected_recommendation");
        assertThat(selectedRecommendation.get("suggested_start_url")).isEqualTo("https://example.com");
        assertThat(response.provenance().get("source_evidence_refs")).asList().containsExactly("cp_001.obs_002");
    }


    @Test
    void createJobAllowsManualScenarioSelectionWithoutDetectedTarget() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioRecommendation unavailable = recommendation();
        unavailable.setScenarioType("SIGNUP_LEAD_FORM");
        unavailable.setRecommendationLevel("NOT_AVAILABLE");
        unavailable.setConfidence(BigDecimal.ZERO);
        unavailable.setEvidenceRefsJsonb("[]");
        unavailable.setSuggestedTargetJsonb("{}");
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(unavailable));
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "가입 / 리드 양식 점검 · 입력 양식까지 보기",
                "SIGNUP_LEAD_FORM",
                Map.of(
                        "scenarioType", "SIGNUP_LEAD_FORM",
                        "recommendationLevel", "LOW",
                        "confidence", BigDecimal.ZERO,
                        "evidenceRefs", List.of(),
                        "suggestedStartUrl", "https://example.com",
                        "suggestedTarget", Map.of()
                ),
                Map.of("depthId", "form-depth"),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );

        ScenarioAuthoringJobResponse response = service.createJob(request, USER_ID, null);

        assertThat(response.status()).isEqualTo(ScenarioAuthoringStatus.QUEUED);
        @SuppressWarnings("unchecked")
        Map<String, Object> selectedRecommendation = (Map<String, Object>) response.input().get("selected_recommendation");
        assertThat(selectedRecommendation.get("scenario_type")).isEqualTo("SIGNUP_LEAD_FORM");
        assertThat(selectedRecommendation.get("recommendation_level")).isEqualTo("NOT_AVAILABLE");
        assertThat(selectedRecommendation.get("suggested_target")).isEqualTo(Map.of());
    }

    @Test
    void createJobRejectsUnsupportedProviderPolicy() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation()));
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "무료 체험 CTA까지의 흐름 점검",
                "LANDING_CTA",
                Map.of("scenarioType", "LANDING_CTA"),
                Map.of(),
                new ScenarioAuthoringProviderPolicyRequest(List.of("CODEX"), 10_000, false, true)
        );

        assertThatThrownBy(() -> service.createJob(request, USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("INTERNAL_LLM and RULE_BASED");
    }

    @Test
    void createJobCanSelectPersistedRecommendationByIdWithoutRedundantScenarioType() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioRecommendation pricing = recommendation();
        pricing.setId(PRICING_RECOMMENDATION_ID);
        pricing.setScenarioType("PRICING");
        pricing.setSuggestedTargetJsonb("{\"href_contains\":\"/pricing\",\"text\":\"Pricing\"}");
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation(), pricing));
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                PRICING_RECOMMENDATION_ID,
                "요금제 흐름 점검",
                null,
                null,
                Map.of(),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );

        ScenarioAuthoringJobResponse response = service.createJob(request, USER_ID, null);

        assertThat(response.status()).isEqualTo(ScenarioAuthoringStatus.QUEUED);
        @SuppressWarnings("unchecked")
        Map<String, Object> selectedRecommendation = (Map<String, Object>) response.input().get("selected_recommendation");
        assertThat(selectedRecommendation.get("recommendation_id")).isEqualTo(PRICING_RECOMMENDATION_ID.toString());
        assertThat(selectedRecommendation.get("scenario_type")).isEqualTo("PRICING");
        assertThat(response.input().get("preferred_scenario_type")).isEqualTo("PRICING");
    }

    @Test
    void createJobIncludesPersistedEvidenceSummaryInAuthoringInput() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioRecommendation recommendation = recommendation();
        recommendation.setEvidenceSummaryJsonb("{\"matched_signals\":[{\"source\":\"aria_label\",\"value\":\"Book a demo\"}],\"missing_signals\":[\"safe_submit_boundary_not_verified\"],\"limitations\":[\"image_text_ocr_not_performed\"]}");
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation));

        ScenarioAuthoringJobResponse response = service.createJob(createRequest(), USER_ID, null);

        @SuppressWarnings("unchecked")
        Map<String, Object> selectedRecommendation = (Map<String, Object>) response.input().get("selected_recommendation");
        @SuppressWarnings("unchecked")
        Map<String, Object> evidenceSummary = (Map<String, Object>) selectedRecommendation.get("evidence_summary");
        assertThat(evidenceSummary.get("matched_signals")).asList().hasSize(1);
        assertThat(evidenceSummary.get("limitations")).asList().contains("image_text_ocr_not_performed");
    }

    @Test
    void createJobRejectsRecommendationIdAndScenarioTypeMismatch() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioRecommendation pricing = recommendation();
        pricing.setId(RECOMMENDATION_ID);
        pricing.setScenarioType("PRICING");
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(pricing));
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                RECOMMENDATION_ID,
                "요금제 흐름 점검",
                "LANDING_CTA",
                null,
                Map.of(),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );

        assertThatThrownBy(() -> service.createJob(request, USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("does not match preferredScenarioType");
    }

    @Test
    void createJobNormalizesCrossProjectDiscoveryMismatch() {
        SiteDiscovery discovery = discovery();
        discovery.setProjectId(UUID.fromString("8f06dca8-9c4d-4f20-b1a8-1d5ee40a9999"));
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery);

        assertThatThrownBy(() -> service.createJob(createRequest(), USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Selected Discovery recommendation was not found");
    }

    @Test
    void createJobRejectsUnsupportedScenarioTypeBeforeCandidateCanBeMarkedValid() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioAuthoringJobCreateRequest request = new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "커스텀 탐색 흐름 점검",
                "CUSTOM_GUIDED",
                Map.of("scenarioType", "CUSTOM_GUIDED"),
                Map.of(),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );

        assertThatThrownBy(() -> service.createJob(request, USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("does not support scenario type");
    }

    @Test
    void createJobRejectsUnavailableRecommendationBeforeCandidateIsCreated() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioRecommendation unavailable = recommendation();
        unavailable.setRecommendationLevel("NOT_AVAILABLE");
        unavailable.setConfidence(BigDecimal.ZERO);
        unavailable.setEvidenceRefsJsonb("[]");
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(unavailable));

        assertThatThrownBy(() -> service.createJob(createRequestWithoutSelectedRecommendation(), USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("HIGH or MEDIUM");
    }

    @Test
    void createJobRejectsRecommendationWithoutEvidence() {
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery());
        ScenarioRecommendation recommendation = recommendation();
        recommendation.setEvidenceRefsJsonb("[]");
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation));

        assertThatThrownBy(() -> service.createJob(createRequestWithoutSelectedRecommendation(), USER_ID, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("evidence");
    }

    @Test
    void createJobQueuesRunnerAuthoringEvenWhenDiscoveryUrlIsMissing() {
        SiteDiscovery discovery = discovery();
        discovery.setInputUrl("");
        discovery.setFinalUrl("");
        ScenarioRecommendation recommendation = recommendation();
        recommendation.setSuggestedStartUrl("");
        when(discoveryService.findDiscovery(DISCOVERY_ID)).thenReturn(discovery);
        when(scenarioRecommendationMapper.findByDiscoveryId(DISCOVERY_ID)).thenReturn(List.of(recommendation));

        ScenarioAuthoringJobResponse response = service.createJob(createRequest(), USER_ID, null);

        assertThat(response.status()).isEqualTo(ScenarioAuthoringStatus.QUEUED);
        assertThat(response.candidates()).isEmpty();
        assertThat(response.failure()).isNull();
    }

    @Test
    void confirmCandidateStoresSelectedCandidateId() throws Exception {
        UUID jobId = UUID.randomUUID();
        ScenarioAuthoringJob job = new ScenarioAuthoringJob();
        job.setId(jobId);
        job.setProjectId(PROJECT_ID);
        job.setSourceDiscoveryId(DISCOVERY_ID);
        job.setStatus(ScenarioAuthoringStatus.SUCCEEDED);
        job.setInputJsonb("{}");
        job.setProviderPolicyJsonb("{\"provider_order\":[\"RULE_BASED\"]}");
        job.setProviderTraceJsonb("[]");
        job.setCandidatesJsonb(objectMapper.writeValueAsString(List.of(Map.of(
                "candidate_id", "rule_based_landing_cta_001",
                "scenario_plan", Map.of("plan_id", "plan_001"),
                "validation", validValidation()
        ))));
        job.setValidationJsonb(objectMapper.writeValueAsString(validValidation()));
        job.setProvenanceJsonb("{}");
        job.setFailureJsonb("{}");
        job.setCreatedAt(OffsetDateTime.now());
        job.setUpdatedAt(OffsetDateTime.now());
        job.setExpiresAt(OffsetDateTime.now().plusMinutes(10));
        when(scenarioAuthoringJobMapper.findById(jobId)).thenReturn(Optional.of(job));
        when(projectAccessService.isProjectMember(PROJECT_ID, USER_ID)).thenReturn(true);
        when(scenarioAuthoringJobMapper.confirmCandidate(jobId, "rule_based_landing_cta_001", USER_ID)).thenReturn(1);

        var response = service.confirmCandidate(jobId, new ScenarioAuthoringConfirmRequest("rule_based_landing_cta_001"), USER_ID);

        assertThat(response.authoringJob().confirmedCandidateId()).isEqualTo("rule_based_landing_cta_001");
        assertThat(response.confirmedCandidate().get("candidate_id")).isEqualTo("rule_based_landing_cta_001");
        verify(scenarioAuthoringJobMapper).confirmCandidate(jobId, "rule_based_landing_cta_001", USER_ID);
        verify(projectAccessService).isProjectMember(PROJECT_ID, USER_ID);
    }

    @Test
    void confirmCandidateRejectsCandidateThatFailedValidation() throws Exception {
        UUID jobId = UUID.randomUUID();
        ScenarioAuthoringJob job = confirmedJob(jobId, null);
        job.setCandidatesJsonb(objectMapper.writeValueAsString(List.of(Map.of(
                "candidate_id", "rule_based_landing_cta_001",
                "scenario_plan", Map.of("plan_id", "plan_001"),
                "validation", Map.of(
                        "schema_valid", true,
                        "safety_valid", false,
                        "fit_requirements_valid", true,
                        "errors", List.of(Map.of("code", "unsafe_candidate", "message", "unsafe")),
                        "warnings", List.of()
                )
        ))));
        when(scenarioAuthoringJobMapper.findById(jobId)).thenReturn(Optional.of(job));
        when(projectAccessService.isProjectMember(PROJECT_ID, USER_ID)).thenReturn(true);

        assertThatThrownBy(() -> service.confirmCandidate(jobId, new ScenarioAuthoringConfirmRequest("rule_based_landing_cta_001"), USER_ID))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("failed validation");
    }

    @Test
    void confirmCandidateRejectsDifferentAlreadyConfirmedCandidate() throws Exception {
        UUID jobId = UUID.randomUUID();
        ScenarioAuthoringJob job = confirmedJob(jobId, "other_candidate");
        when(scenarioAuthoringJobMapper.findById(jobId)).thenReturn(Optional.of(job));
        when(projectAccessService.isProjectMember(PROJECT_ID, USER_ID)).thenReturn(true);

        assertThatThrownBy(() -> service.confirmCandidate(jobId, new ScenarioAuthoringConfirmRequest("rule_based_landing_cta_001"), USER_ID))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("already confirmed");
    }


    private ScenarioAuthoringJobCreateRequest createRequestWithoutSelectedRecommendation() {
        return new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "무료 체험 CTA까지의 흐름 점검",
                "LANDING_CTA",
                null,
                Map.of(),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );
    }

    private ScenarioAuthoringJobCreateRequest createRequest() {
        return new ScenarioAuthoringJobCreateRequest(
                PROJECT_ID,
                DISCOVERY_ID,
                null,
                "무료 체험 CTA까지의 흐름 점검",
                "LANDING_CTA",
                Map.of(
                        "scenarioType", "LANDING_CTA",
                        "recommendationLevel", "HIGH",
                        "confidence", new BigDecimal("0.86"),
                        "evidenceRefs", List.of("cp_001.obs_002"),
                        "suggestedStartUrl", "https://example.com",
                        "suggestedTarget", Map.of("href_contains", "/signup", "text", "Start free")
                ),
                Map.of("do_not_submit_real_forms", true),
                new ScenarioAuthoringProviderPolicyRequest(List.of("RULE_BASED"), 10_000, true, true)
        );
    }

    private SiteDiscovery discovery() {
        SiteDiscovery discovery = new SiteDiscovery();
        discovery.setId(DISCOVERY_ID);
        discovery.setProjectId(PROJECT_ID);
        discovery.setInputUrl("https://example.com");
        discovery.setFinalUrl("https://example.com");
        discovery.setDevicePreset("desktop");
        discovery.setViewportJsonb("{\"width\":1440,\"height\":900}");
        discovery.setSummaryJsonb("{\"detectedFlowTypes\":[\"LANDING_CTA\"],\"missingFlowTypes\":[]}");
        return discovery;
    }

    private ScenarioAuthoringJob confirmedJob(UUID jobId, String confirmedCandidateId) throws Exception {
        ScenarioAuthoringJob job = new ScenarioAuthoringJob();
        job.setId(jobId);
        job.setProjectId(PROJECT_ID);
        job.setSourceDiscoveryId(DISCOVERY_ID);
        job.setStatus(ScenarioAuthoringStatus.SUCCEEDED);
        job.setInputJsonb("{}");
        job.setProviderPolicyJsonb("{\"provider_order\":[\"RULE_BASED\"]}");
        job.setProviderTraceJsonb("[]");
        job.setCandidatesJsonb(objectMapper.writeValueAsString(List.of(Map.of(
                "candidate_id", "rule_based_landing_cta_001",
                "scenario_plan", Map.of("plan_id", "plan_001"),
                "validation", validValidation()
        ))));
        job.setValidationJsonb(objectMapper.writeValueAsString(validValidation()));
        job.setProvenanceJsonb("{}");
        job.setFailureJsonb("{}");
        job.setConfirmedCandidateId(confirmedCandidateId);
        job.setCreatedAt(OffsetDateTime.now());
        job.setUpdatedAt(OffsetDateTime.now());
        job.setExpiresAt(OffsetDateTime.now().plusMinutes(10));
        return job;
    }

    private Map<String, Object> validValidation() {
        return Map.of(
                "schema_valid", true,
                "safety_valid", true,
                "fit_requirements_valid", true,
                "errors", List.of(),
                "warnings", List.of()
        );
    }

    private ScenarioRecommendation recommendation() {
        ScenarioRecommendation recommendation = new ScenarioRecommendation();
        recommendation.setId(RECOMMENDATION_ID);
        recommendation.setDiscoveryId(DISCOVERY_ID);
        recommendation.setScenarioType("LANDING_CTA");
        recommendation.setRecommendationLevel("HIGH");
        recommendation.setConfidence(new BigDecimal("0.86"));
        recommendation.setReason("First-view primary CTA supports a landing CTA scenario.");
        recommendation.setEvidenceRefsJsonb("[\"cp_001.obs_002\"]");
        recommendation.setSuggestedStartUrl("https://example.com");
        recommendation.setSuggestedTargetJsonb("{\"href_contains\":\"/signup\",\"text\":\"Start free\"}");
        return recommendation;
    }
}
