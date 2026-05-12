package com.wedge.scenarioauthoring.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringConfirmResponse;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobCreateRequest;
import com.wedge.scenarioauthoring.api.dto.ScenarioAuthoringJobResponse;
import com.wedge.scenarioauthoring.application.ScenarioAuthoringJobService;
import com.wedge.scenarioauthoring.domain.ScenarioAuthoringStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ScenarioAuthoringJobControllerTest {
    private static final UUID USER_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID PROJECT_ID = UUID.fromString("8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923");
    private static final UUID DISCOVERY_ID = UUID.fromString("20000000-0000-4000-8000-000000000011");

    private final ScenarioAuthoringJobService service = mock(ScenarioAuthoringJobService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ScenarioAuthoringJobController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestIdFilter())
            .build();

    @Test
    void createJobReturnsAcceptedEnvelope() throws Exception {
        UUID jobId = UUID.randomUUID();
        when(service.createJob(any(ScenarioAuthoringJobCreateRequest.class), eq(USER_ID), eq("idem-1")))
                .thenReturn(response(jobId, null));

        mockMvc.perform(post("/api/scenario-authoring-jobs")
                        .principal(authentication())
                        .header("Idempotency-Key", "idem-1")
                        .header("X-Request-Id", "req_authoring_create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "projectId": "%s",
                                  "sourceDiscoveryId": "%s",
                                  "requestedGoal": "무료 체험 CTA까지의 흐름 점검",
                                  "preferredScenarioType": "LANDING_CTA",
                                  "selectedRecommendation": {"scenarioType": "LANDING_CTA", "evidenceRefs": ["cp_001.obs_002"]}
                                }
                                """.formatted(PROJECT_ID, DISCOVERY_ID)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.authoringJobId").value(jobId.toString()))
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.data.candidateCount").value(0))
                .andExpect(jsonPath("$.meta.requestId").value("req_authoring_create"));
    }

    @Test
    void confirmCandidateReturnsCandidateEnvelope() throws Exception {
        UUID jobId = UUID.randomUUID();
        when(service.confirmCandidate(eq(jobId), any(), eq(USER_ID)))
                .thenReturn(new ScenarioAuthoringConfirmResponse(
                        response(jobId, "rule_based_landing_cta_001"),
                        Map.of("candidate_id", "rule_based_landing_cta_001")
                ));

        mockMvc.perform(post("/api/scenario-authoring-jobs/{authoringJobId}/confirm", jobId)
                        .principal(authentication())
                        .header("X-Request-Id", "req_authoring_confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"candidateId\":\"rule_based_landing_cta_001\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.authoringJob.confirmedCandidateId").value("rule_based_landing_cta_001"))
                .andExpect(jsonPath("$.data.confirmedCandidate.candidate_id").value("rule_based_landing_cta_001"))
                .andExpect(jsonPath("$.meta.requestId").value("req_authoring_confirm"));
    }

    @Test
    void getJobReturnsJobEnvelope() throws Exception {
        UUID jobId = UUID.randomUUID();
        when(service.getJob(jobId, USER_ID)).thenReturn(response(jobId, null));

        mockMvc.perform(get("/api/scenario-authoring-jobs/{authoringJobId}", jobId)
                        .principal(authentication())
                        .header("X-Request-Id", "req_authoring_get"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.authoringJobId").value(jobId.toString()))
                .andExpect(jsonPath("$.data.providerOrder[0]").value("RULE_BASED"))
                .andExpect(jsonPath("$.meta.requestId").value("req_authoring_get"));
    }

    private ScenarioAuthoringJobResponse response(UUID jobId, String confirmedCandidateId) {
        OffsetDateTime now = OffsetDateTime.parse("2026-05-06T12:00:00+09:00");
        return new ScenarioAuthoringJobResponse(
                "0.5",
                jobId,
                ScenarioAuthoringStatus.QUEUED,
                PROJECT_ID,
                DISCOVERY_ID,
                "corr_001",
                0,
                List.of("RULE_BASED"),
                Map.of(),
                Map.of("provider_order", List.of("RULE_BASED")),
                List.of(),
                List.of(),
                Map.of("schema_valid", true),
                Map.of("source_discovery_id", DISCOVERY_ID.toString()),
                null,
                confirmedCandidateId,
                null,
                null,
                null,
                now,
                now,
                now.plusMinutes(30)
        );
    }

    private UsernamePasswordAuthenticationToken authentication() {
        WedgePrincipal principal = new WedgePrincipal(USER_ID, "tester@example.com", "Tester");
        return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
    }
}
