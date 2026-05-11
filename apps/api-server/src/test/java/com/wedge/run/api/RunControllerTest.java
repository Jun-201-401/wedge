package com.wedge.run.api;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.api.dto.EvidenceCountsResponse;
import com.wedge.evidence.api.dto.LatestCheckpointResponse;
import com.wedge.evidence.api.dto.RunEvidenceSummaryResponse;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.run.api.dto.RunEventResponse;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.api.dto.RunStepResponse;
import com.wedge.run.application.RunEventListResult;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.domain.StepStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RunControllerTest {
    private static final MappingJackson2HttpMessageConverter JSON_CONVERTER = new MappingJackson2HttpMessageConverter(
            new ObjectMapper()
                    .findAndRegisterModules()
                    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    );

    private final RunService runService = org.mockito.Mockito.mock(RunService.class);
    private final EvidenceService evidenceService = org.mockito.Mockito.mock(EvidenceService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new RunController(runService, evidenceService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(JSON_CONVERTER)
            .addFilters(new RequestIdFilter())
            .build();

    @Test
    void liveReturnsLatestEvidenceSummary() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        RunResponse run = sampleRun(runId);
        ArtifactResponse screenshotArtifact = sampleArtifact(runId, stepId, artifactId, ArtifactType.SCREENSHOT);
        when(runService.getRun(runId)).thenReturn(run);
        when(evidenceService.getRunEvidenceSummary(run)).thenReturn(new RunEvidenceSummaryResponse(
                new LatestCheckpointResponse(
                        "cp_001",
                        stepId,
                        "CTA",
                        "https://example.com/signup",
                        OffsetDateTime.parse("2026-04-28T10:00:00+09:00"),
                        340,
                        1,
                        1
                ),
                screenshotArtifact,
                screenshotArtifact,
                new EvidenceCountsResponse(1, 1, 1)
        ));

        mockMvc.perform(get("/api/runs/{runId}/live", runId)
                        .header("X-Request-Id", "req_run_live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.status").value("RUNNING"))
                .andExpect(jsonPath("$.data.currentStepOrder").value(1))
                .andExpect(jsonPath("$.data.latestCheckpoint.checkpointId").value("cp_001"))
                .andExpect(jsonPath("$.data.latestCheckpoint.stepId").value(stepId.toString()))
                .andExpect(jsonPath("$.data.latestCheckpoint.stage").value("CTA"))
                .andExpect(jsonPath("$.data.latestCheckpoint.observationCount").value(1))
                .andExpect(jsonPath("$.data.latestArtifact.id").value(artifactId.toString()))
                .andExpect(jsonPath("$.data.latestArtifact.contentUrl").value("/api/runs/" + runId + "/artifacts/" + artifactId + "/content"))
                .andExpect(jsonPath("$.data.latestFrame.artifactId").value(artifactId.toString()))
                .andExpect(jsonPath("$.data.evidenceCounts.checkpointCount").value(1))
                .andExpect(jsonPath("$.data.evidenceCounts.observationCount").value(1))
                .andExpect(jsonPath("$.data.evidenceCounts.artifactCount").value(1))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_live"));
    }

    @Test
    void stepsReturnsPersistedRunStepList() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        when(runService.listRunSteps(runId)).thenReturn(List.of(new RunStepResponse(
                stepId,
                runId,
                2,
                "step_002_submit",
                "CTA 제출",
                "CLICK",
                StepStatus.FAILED,
                OffsetDateTime.parse("2026-04-28T10:00:00+09:00"),
                OffsetDateTime.parse("2026-04-28T10:00:03+09:00"),
                "RUNNER_TIMEOUT",
                "locator click timed out"
        )));

        mockMvc.perform(get("/api/runs/{runId}/steps", runId)
                        .header("X-Request-Id", "req_run_steps"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(stepId.toString()))
                .andExpect(jsonPath("$.data[0].runId").value(runId.toString()))
                .andExpect(jsonPath("$.data[0].stepOrder").value(2))
                .andExpect(jsonPath("$.data[0].stepKey").value("step_002_submit"))
                .andExpect(jsonPath("$.data[0].stepName").value("CTA 제출"))
                .andExpect(jsonPath("$.data[0].stepType").value("CLICK"))
                .andExpect(jsonPath("$.data[0].status").value("FAILED"))
                .andExpect(jsonPath("$.data[0].errorCode").value("RUNNER_TIMEOUT"))
                .andExpect(jsonPath("$.data[0].errorMessage").value("locator click timed out"))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_steps"));
    }

    @Test
    void stepDetailReturnsPersistedRunStep() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        when(runService.getRunStep(runId, stepId)).thenReturn(new RunStepResponse(
                stepId,
                runId,
                1,
                "step_001_goto",
                "첫 화면 로드",
                "GOTO",
                StepStatus.PASSED,
                OffsetDateTime.parse("2026-04-28T09:59:00+09:00"),
                OffsetDateTime.parse("2026-04-28T09:59:01+09:00"),
                null,
                null
        ));

        mockMvc.perform(get("/api/runs/{runId}/steps/{stepId}", runId, stepId)
                        .header("X-Request-Id", "req_run_step_detail"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(stepId.toString()))
                .andExpect(jsonPath("$.data.stepKey").value("step_001_goto"))
                .andExpect(jsonPath("$.data.status").value("PASSED"))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_step_detail"));
    }

    @Test
    void eventsReturnsPersistedRunEventList() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        when(runService.listRunEvents(runId, null, null, null, null)).thenReturn(new RunEventListResult(List.of(new RunEventResponse(
                eventId,
                runId,
                stepId,
                "step_002_submit",
                "STEP_FAILED",
                "RUNNER",
                Map.of(
                        "message", "locator click timed out",
                        "failureCode", "RUNNER_TIMEOUT"
                ),
                OffsetDateTime.parse("2026-04-28T10:00:03+09:00")
        )), null, false));

        mockMvc.perform(get("/api/runs/{runId}/events", runId)
                        .header("X-Request-Id", "req_run_events"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(eventId.toString()))
                .andExpect(jsonPath("$.data[0].runId").value(runId.toString()))
                .andExpect(jsonPath("$.data[0].stepId").value(stepId.toString()))
                .andExpect(jsonPath("$.data[0].stepKey").value("step_002_submit"))
                .andExpect(jsonPath("$.data[0].eventType").value("STEP_FAILED"))
                .andExpect(jsonPath("$.data[0].eventSource").value("RUNNER"))
                .andExpect(jsonPath("$.data[0].payload.message").value("locator click timed out"))
                .andExpect(jsonPath("$.data[0].payload.failureCode").value("RUNNER_TIMEOUT"))
                .andExpect(jsonPath("$.data[0].occurredAt").value("2026-04-28T10:00:03+09:00"))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_events"))
                .andExpect(jsonPath("$.meta.hasMore").value(false));
    }

    @Test
    void eventsPassesQueryParamsAndReturnsPageMeta() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID stepId = UUID.randomUUID();
        UUID cursor = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        RunEventResponse event = new RunEventResponse(
                eventId,
                runId,
                stepId,
                "step_002_submit",
                "STEP_FAILED",
                "RUNNER",
                Map.of("message", "locator click timed out"),
                OffsetDateTime.parse("2026-04-28T10:00:03+09:00")
        );
        when(runService.listRunEvents(runId, stepId, "STEP_FAILED", cursor.toString(), 1))
                .thenReturn(new RunEventListResult(List.of(event), eventId.toString(), true));

        mockMvc.perform(get("/api/runs/{runId}/events", runId)
                        .param("stepId", stepId.toString())
                        .param("eventType", "STEP_FAILED")
                        .param("cursor", cursor.toString())
                        .param("limit", "1")
                        .header("X-Request-Id", "req_run_events_page"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(eventId.toString()))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_events_page"))
                .andExpect(jsonPath("$.meta.nextCursor").value(eventId.toString()))
                .andExpect(jsonPath("$.meta.hasMore").value(true));
        verify(runService).listRunEvents(runId, stepId, "STEP_FAILED", cursor.toString(), 1);
    }

    @Test
    void agentStartQueuesAgentRun() throws Exception {
        UUID runId = UUID.randomUUID();
        RunResponse queued = sampleRun(runId, RunStatus.QUEUED);
        when(runService.startAgentRun(runId)).thenReturn(queued);

        mockMvc.perform(post("/api/runs/{runId}/agent/start", runId)
                        .header("X-Request-Id", "req_agent_start"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.runId").value(runId.toString()))
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.meta.requestId").value("req_agent_start"));

        verify(runService).startAgentRun(runId);
    }

    @Test
    void artifactsReturnsPersistedArtifactList() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        when(evidenceService.listRunArtifacts(runId)).thenReturn(List.of(
                sampleArtifact(runId, null, artifactId, ArtifactType.DOM_SNAPSHOT)
        ));

        mockMvc.perform(get("/api/runs/{runId}/artifacts", runId)
                        .header("X-Request-Id", "req_run_artifacts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(artifactId.toString()))
                .andExpect(jsonPath("$.data[0].artifactType").value("DOM_SNAPSHOT"))
                .andExpect(jsonPath("$.data[0].contentUrl").value("/api/runs/" + runId + "/artifacts/" + artifactId + "/content"))
                .andExpect(jsonPath("$.meta.requestId").value("req_run_artifacts"));
    }

    @Test
    void evidencePacketReturnsPersistedEvidencePacket() throws Exception {
        UUID runId = UUID.randomUUID();
        when(evidenceService.getRunEvidencePacket(runId)).thenReturn(Map.of(
                "run_id", runId.toString(),
                "checkpoints", List.of(Map.of(
                        "checkpoint_id", "cp_001",
                        "observations", List.of(Map.of("observation_id", "obs_001"))
                )),
                "artifacts", List.of(Map.of("artifact_id", UUID.randomUUID().toString())),
                "aggregate_signals", Map.of("checkpoint_count", 1, "observation_count", 1, "artifact_count", 1)
        ));

        mockMvc.perform(get("/api/runs/{runId}/evidence-packet", runId)
                        .header("X-Request-Id", "req_evidence_packet"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.run_id").value(runId.toString()))
                .andExpect(jsonPath("$.data.checkpoints[0].checkpoint_id").value("cp_001"))
                .andExpect(jsonPath("$.data.checkpoints[0].observations[0].observation_id").value("obs_001"))
                .andExpect(jsonPath("$.data.aggregate_signals.checkpoint_count").value(1))
                .andExpect(jsonPath("$.meta.requestId").value("req_evidence_packet"));
    }

    private ArtifactResponse sampleArtifact(UUID runId, UUID stepId, UUID artifactId, ArtifactType artifactType) {
        return new ArtifactResponse(
                artifactId,
                runId,
                stepId,
                stepId == null ? null : "step_001_click_cta",
                artifactType,
                "wedge-dev-artifacts",
                artifactType == ArtifactType.SCREENSHOT ? "runs/dev/cp_001.png" : "runs/dev/dom.html",
                artifactType == ArtifactType.SCREENSHOT ? "image/png" : "text/html",
                artifactType == ArtifactType.SCREENSHOT ? 1440 : null,
                artifactType == ArtifactType.SCREENSHOT ? 900 : null,
                artifactType == ArtifactType.SCREENSHOT ? 2048 : 512,
                "sha256",
                null,
                "/api/runs/" + runId + "/artifacts/" + artifactId + "/content",
                OffsetDateTime.parse("2026-04-28T10:00:01+09:00")
        );
    }

    private RunResponse sampleRun(UUID runId) {
        return sampleRun(runId, RunStatus.RUNNING);
    }

    private RunResponse sampleRun(UUID runId, RunStatus status) {
        return new RunResponse(
                runId,
                "run",
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "CTA flow",
                "desktop",
                UUID.randomUUID(),
                status,
                ResultCompleteness.NONE,
                AnalysisStatus.NOT_STARTED,
                1,
                OffsetDateTime.parse("2026-04-28T09:59:00+09:00"),
                null,
                null,
                null,
                null
        );
    }
}
