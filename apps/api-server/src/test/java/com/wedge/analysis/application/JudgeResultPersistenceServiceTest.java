package com.wedge.analysis.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.domain.Nudge;
import com.wedge.analysis.domain.RuleHit;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.analysis.infrastructure.NudgeMapper;
import com.wedge.analysis.infrastructure.RuleHitMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.analysis.api.internal.dto.AnalyzerCompletedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerFailedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerStartedRequest;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.infrastructure.RunMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class JudgeResultPersistenceServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private AnalysisJobMapper analysisJobMapper;

    @Mock
    private RuleHitMapper ruleHitMapper;

    @Mock
    private AnalysisFindingMapper analysisFindingMapper;

    @Mock
    private NudgeMapper nudgeMapper;

    @Mock
    private RunMapper runMapper;

    @Captor
    private ArgumentCaptor<AnalysisJob> analysisJobCaptor;

    @Captor
    private ArgumentCaptor<RuleHit> ruleHitCaptor;

    @Captor
    private ArgumentCaptor<AnalysisFinding> findingCaptor;

    @Captor
    private ArgumentCaptor<Nudge> nudgeCaptor;

    private JudgeResultPersistenceService judgeResultPersistenceService;

    @BeforeEach
    void setUp() {
        judgeResultPersistenceService = new JudgeResultPersistenceService(
                analysisJobMapper,
                ruleHitMapper,
                analysisFindingMapper,
                nudgeMapper,
                runMapper,
                objectMapper
        );
    }

    @Test
    void saveStartedMarksAnalysisJobRunning() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AnalyzerStartedRequest request = startedRequest(analysisJobId, runId);
        when(analysisJobMapper.markRunning(analysisJobId, runId, request.startedAt())).thenReturn(1);

        Map<String, Object> response = judgeResultPersistenceService.saveStarted(request);

        assertThat(response.get("status")).isEqualTo(AnalysisJobStatus.RUNNING);
        verify(analysisJobMapper).markRunning(analysisJobId, runId, request.startedAt());
        verify(runMapper).updateCurrentAnalysisState(runId, AnalysisStatus.RUNNING, analysisJobId, null, null);
    }

    @Test
    void saveStartedDoesNotRegressCompletedJob() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AnalyzerStartedRequest request = startedRequest(analysisJobId, runId);
        AnalysisJob completedJob = analysisJob(analysisJobId, runId, AnalysisJobStatus.COMPLETED);
        when(analysisJobMapper.markRunning(analysisJobId, runId, request.startedAt())).thenReturn(0);
        when(analysisJobMapper.findById(analysisJobId)).thenReturn(Optional.of(completedJob));

        Map<String, Object> response = judgeResultPersistenceService.saveStarted(request);

        assertThat(response.get("status")).isEqualTo(AnalysisJobStatus.COMPLETED);
        assertThat(response.get("ignored")).isEqualTo(true);
        verify(runMapper, never()).updateCurrentAnalysisState(runId, AnalysisStatus.RUNNING, analysisJobId, null, null);
    }

    @Test
    void saveCompletedPersistsJudgeResultProjections() throws Exception {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AnalyzerCompletedRequest request = completedRequest(analysisJobId, runId);

        Map<String, Object> response = judgeResultPersistenceService.saveCompleted(request);

        assertThat(response.get("status")).isEqualTo(AnalysisJobStatus.COMPLETED);
        assertThat(response.get("issueCount")).isEqualTo(1);
        assertThat(response.get("nudgeCount")).isEqualTo(1);
        verifyCompletedJob(analysisJobId, runId);
        verifyIssueProjection(analysisJobId, runId);
        verifyNudgeProjection(analysisJobId);
        verify(runMapper).updateCurrentAnalysisState(runId, AnalysisStatus.COMPLETED, analysisJobId, new BigDecimal("61.0"), null);
    }

    @Test
    void saveCompletedEnrichesProblemComponentRefWithoutDroppingTechnicalEvidence() throws Exception {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        Map<String, Object> issue = issue();
        issue.put("evidence_refs", List.of("cp_001.obs_network_failure"));
        issue.put("problem_components", List.of(Map.of(
                "component_id", "cp_001.obs_interactive_components.component_001",
                "evidence_ref", "cp_001.obs_interactive_components",
                "label", "Start free",
                "selector", "a.hero-start",
                "coordinate_space", "viewport",
                "bounding_box", Map.of("x", 520, "y", 360, "width", 220, "height", 56),
                "viewport", Map.of("width", 1440, "height", 900),
                "screenshot_artifact_id", "screenshot-1"
        )));
        AnalyzerCompletedRequest request = completedRequest(analysisJobId, runId, List.of(issue));

        judgeResultPersistenceService.saveCompleted(request);

        verify(ruleHitMapper).insert(ruleHitCaptor.capture());
        assertThat(ruleHitCaptor.getValue().getEvidenceRefsJsonb())
                .contains("cp_001.obs_network_failure")
                .doesNotContain("cp_001.obs_interactive_components");
        verify(analysisFindingMapper).insert(findingCaptor.capture());
        AnalysisFinding finding = findingCaptor.getValue();
        List<Object> findingRefs = objectMapper.readValue(finding.getEvidenceRefsJsonb(), new TypeReference<>() {});
        assertThat(findingRefs).hasSize(2);
        assertThat(findingRefs.get(0)).isEqualTo("cp_001.obs_network_failure");
        assertThat(findingRefs.get(1)).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> componentRef = (Map<String, Object>) findingRefs.get(1);
        assertThat(componentRef.get("ref")).isEqualTo("cp_001.obs_interactive_components");
        assertThat(componentRef.get("problemComponent")).isInstanceOf(Map.class);
    }

    @Test
    void saveFailedMarksAnalysisJobFailed() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AnalyzerFailedRequest request = new AnalyzerFailedRequest(
                analysisJobId,
                runId,
                OffsetDateTime.parse("2026-04-28T11:10:00+09:00"),
                "ANALYZER_TIMEOUT",
                "Analyzer timed out"
        );

        Map<String, Object> response = judgeResultPersistenceService.saveFailed(request);

        assertThat(response.get("status")).isEqualTo(AnalysisJobStatus.FAILED);
        verify(analysisJobMapper).upsertFailed(analysisJobCaptor.capture());
        AnalysisJob analysisJob = analysisJobCaptor.getValue();
        assertThat(analysisJob.getId()).isEqualTo(analysisJobId);
        assertThat(analysisJob.getRunId()).isEqualTo(runId);
        assertThat(analysisJob.getErrorCode()).isEqualTo("ANALYZER_TIMEOUT");
        verify(runMapper).updateCurrentAnalysisState(runId, AnalysisStatus.FAILED, analysisJobId, null, null);
    }

    @Test
    void saveCompletedRejectsIssueWithoutStage() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        Map<String, Object> issue = issue();
        issue.remove("stage");
        AnalyzerCompletedRequest request = completedRequest(analysisJobId, runId, List.of(issue));

        assertThatThrownBy(() -> judgeResultPersistenceService.saveCompleted(request))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.INVALID_REQUEST);

        verify(analysisJobMapper, never()).upsertCompleted(org.mockito.ArgumentMatchers.any());
        verify(ruleHitMapper, never()).insert(org.mockito.ArgumentMatchers.any());
        verify(analysisFindingMapper, never()).insert(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void saveCompletedRejectsIssueWithInvalidStage() {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        Map<String, Object> issue = issue();
        issue.put("stage", "UNKNOWN_STAGE");
        AnalyzerCompletedRequest request = completedRequest(analysisJobId, runId, List.of(issue));

        assertThatThrownBy(() -> judgeResultPersistenceService.saveCompleted(request))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.INVALID_REQUEST);

        verify(analysisJobMapper, never()).upsertCompleted(org.mockito.ArgumentMatchers.any());
        verify(ruleHitMapper, never()).insert(org.mockito.ArgumentMatchers.any());
        verify(analysisFindingMapper, never()).insert(org.mockito.ArgumentMatchers.any());
    }

    private AnalyzerStartedRequest startedRequest(UUID analysisJobId, UUID runId) {
        return new AnalyzerStartedRequest(
                analysisJobId,
                runId,
                OffsetDateTime.parse("2026-04-28T10:59:00+09:00")
        );
    }

    private AnalysisJob analysisJob(UUID analysisJobId, UUID runId, AnalysisJobStatus status) {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(analysisJobId);
        analysisJob.setRunId(runId);
        analysisJob.setStatus(status);
        return analysisJob;
    }

    private void verifyCompletedJob(UUID analysisJobId, UUID runId) throws Exception {
        verify(analysisJobMapper).upsertCompleted(analysisJobCaptor.capture());
        AnalysisJob analysisJob = analysisJobCaptor.getValue();
        assertThat(analysisJob.getId()).isEqualTo(analysisJobId);
        assertThat(analysisJob.getRunId()).isEqualTo(runId);
        assertThat(analysisJob.getFrictionScore()).isEqualByComparingTo(new BigDecimal("61.0"));
        Map<String, Object> output = objectMapper.readValue(analysisJob.getOutputJsonb(), new TypeReference<>() {});
        assertThat(output).containsKeys("judgeResult", "topFindings", "nudges");
    }

    private void verifyIssueProjection(UUID analysisJobId, UUID runId) throws Exception {
        verify(ruleHitMapper).insert(ruleHitCaptor.capture());
        RuleHit ruleHit = ruleHitCaptor.getValue();
        assertThat(ruleHit.getAnalysisJobId()).isEqualTo(analysisJobId);
        assertThat(ruleHit.getRunId()).isEqualTo(runId);
        assertThat(ruleHit.getCriterionId()).isEqualTo("INPUT-ASYNC-001");
        assertThat(ruleHit.getEvidenceRefsJsonb()).contains("cp_002.obs_004");

        verify(analysisFindingMapper).insert(findingCaptor.capture());
        AnalysisFinding finding = findingCaptor.getValue();
        assertThat(finding.getRankOrder()).isEqualTo(1);
        assertThat(finding.getCategory()).isEqualTo("INPUT-ASYNC-001");
        assertThat(finding.getSummary()).isEqualTo("이메일 검증 상태가 지연됩니다.");
        List<Map<String, Object>> findingRefs = objectMapper.readValue(finding.getEvidenceRefsJsonb(), new TypeReference<>() {});
        assertThat(findingRefs).singleElement()
                .satisfies(ref -> {
                    assertThat(ref.get("ref")).isEqualTo("cp_002.obs_004");
                    assertThat(ref.get("problemComponent")).isInstanceOf(Map.class);
                });
    }

    private void verifyNudgeProjection(UUID analysisJobId) {
        verify(nudgeMapper).insert(nudgeCaptor.capture());
        Nudge nudge = nudgeCaptor.getValue();
        assertThat(nudge.getAnalysisJobId()).isEqualTo(analysisJobId);
        assertThat(nudge.getFindingId()).isEqualTo(findingCaptor.getValue().getId());
        assertThat(nudge.getRecommendation()).isEqualTo("검증 진행 상태를 입력 필드 근처에 표시합니다.");
    }

    private AnalyzerCompletedRequest completedRequest(UUID analysisJobId, UUID runId) {
        return completedRequest(analysisJobId, runId, List.of(issue()));
    }

    private AnalyzerCompletedRequest completedRequest(
            UUID analysisJobId,
            UUID runId,
            List<Map<String, Object>> issues
    ) {
        return new AnalyzerCompletedRequest(
                analysisJobId,
                runId,
                "analyzer-0.5.0",
                "judge-prompts-2026-04-21",
                Map.of("llm", "gpt-5.4-mini"),
                List.of(Map.of("rank", 1, "title", "입력 검증 지연")),
                List.of(Map.of("title", "top-level nudge")),
                judgeResult(runId, issues),
                OffsetDateTime.parse("2026-04-28T11:00:00+09:00")
        );
    }

    private Map<String, Object> judgeResult(UUID runId, List<Map<String, Object>> issues) {
        return Map.of(
                "schema_version", "0.5",
                "run_id", runId.toString(),
                "summary", Map.of("friction_score", 61.0, "top_issues_count", 1),
                "issues", issues,
                "decision_map", List.of(Map.of("stage", "INPUT", "status", "WARNING")),
                "nudges", List.of(nudge())
        );
    }

    private Map<String, Object> issue() {
        Map<String, Object> issue = new LinkedHashMap<>();
        issue.put("issue_id", "issue_002");
        issue.put("criterion_id", "INPUT-ASYNC-001");
        issue.put("stage", "INPUT");
        issue.put("axis", "Clarity");
        issue.put("severity", 1);
        issue.put("confidence", 0.72);
        issue.put("priority_score", 1.44);
        issue.put("evidence_refs", List.of("cp_002.obs_004"));
        issue.put("problem_components", List.of(Map.of(
                "component_id", "component_001",
                "evidence_ref", "cp_002.obs_004",
                "label", "Start free",
                "selector", "a.hero-start",
                "coordinate_space", "viewport",
                "bounding_box", Map.of("x", 520, "y", 360, "width", 220, "height", 56),
                "viewport", Map.of("width", 1440, "height", 900),
                "screenshot_artifact_id", "screenshot-1"
        )));
        issue.put("observations", List.of("validation response observed"));
        issue.put("signals", List.of("server round-trip"));
        issue.put("summary", "이메일 검증 상태가 지연됩니다.");
        issue.put("impact_hypothesis", "사용자가 입력 반영 여부를 확신하기 어렵습니다.");
        return issue;
    }

    private Map<String, Object> nudge() {
        return Map.of(
                "nudge_id", "nudge_002",
                "issue_id", "issue_002",
                "title", "검증 상태 표시",
                "rationale", "비동기 검증 evidence가 있습니다.",
                "recommendation", "검증 진행 상태를 입력 필드 근처에 표시합니다.",
                "difficulty", "LOW",
                "expected_effect", "입력 불확실성을 줄입니다.",
                "validation_question", "사용자가 검증 중임을 인지하나요?"
        );
    }
}
