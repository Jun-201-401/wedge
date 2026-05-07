package com.wedge.analysis.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.api.internal.dto.AnalyzerCompletedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerFailedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerStartedRequest;
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
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.infrastructure.RunMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JudgeResultPersistenceService {
    private static final int FIRST_RANK_ORDER = 1;
    private static final int RANK_ORDER_INCREMENT = 1;
    private static final List<String> VALID_STAGES = List.of("FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT");
    private static final List<String> VALID_DIFFICULTIES = List.of("LOW", "MEDIUM", "HIGH");

    private final AnalysisJobMapper analysisJobMapper;
    private final RuleHitMapper ruleHitMapper;
    private final AnalysisFindingMapper analysisFindingMapper;
    private final NudgeMapper nudgeMapper;
    private final RunMapper runMapper;
    private final ObjectMapper objectMapper;

    public JudgeResultPersistenceService(
            AnalysisJobMapper analysisJobMapper,
            RuleHitMapper ruleHitMapper,
            AnalysisFindingMapper analysisFindingMapper,
            NudgeMapper nudgeMapper,
            RunMapper runMapper,
            ObjectMapper objectMapper
    ) {
        this.analysisJobMapper = analysisJobMapper;
        this.ruleHitMapper = ruleHitMapper;
        this.analysisFindingMapper = analysisFindingMapper;
        this.nudgeMapper = nudgeMapper;
        this.runMapper = runMapper;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Map<String, Object> saveStarted(AnalyzerStartedRequest request) {
        int updated = analysisJobMapper.markRunning(request.analysisJobId(), request.runId(), request.startedAt());
        if (updated > 0) {
            runMapper.updateCurrentAnalysisState(request.runId(), AnalysisStatus.RUNNING, request.analysisJobId(), null, null);
            return startedResponse(request);
        }

        AnalysisJob existing = analysisJobMapper.findById(request.analysisJobId())
                .orElseThrow(() -> new BusinessException(ErrorCode.RUN_NOT_FOUND, "AnalysisJob was not found."));
        validateStartedRunId(request, existing);
        if (existing.getStatus() == AnalysisJobStatus.RUNNING) {
            return Map.of(
                    "analysisJobId", request.analysisJobId(),
                    "runId", request.runId(),
                    "status", AnalysisJobStatus.RUNNING,
                    "alreadyRunning", true
            );
        }
        if (isTerminalStatus(existing.getStatus())) {
            return Map.of(
                    "analysisJobId", request.analysisJobId(),
                    "runId", request.runId(),
                    "status", existing.getStatus(),
                    "ignored", true
            );
        }
        throw new BusinessException(ErrorCode.STATE_CONFLICT, "AnalysisJob cannot be marked RUNNING from current state.");
    }

    @Transactional
    public Map<String, Object> saveCompleted(AnalyzerCompletedRequest request) {
        List<Map<String, Object>> issues = readList(request.judgeResult(), "issues");
        validateIssueStages(issues);
        analysisJobMapper.upsertCompleted(toCompletedAnalysisJob(request));
        clearProjectionRows(request.analysisJobId());
        Map<String, UUID> findingIdsByIssueId = persistIssues(request.analysisJobId(), request.runId(), issues);
        int nudgeCount = persistNudges(request, findingIdsByIssueId);
        runMapper.updateCurrentAnalysisState(request.runId(), AnalysisStatus.COMPLETED, request.analysisJobId(), readFrictionScore(request.judgeResult()), null);
        return completedResponse(request, issues.size(), nudgeCount);
    }

    @Transactional
    public Map<String, Object> saveFailed(AnalyzerFailedRequest request) {
        analysisJobMapper.upsertFailed(toFailedAnalysisJob(request));
        runMapper.updateCurrentAnalysisState(request.runId(), AnalysisStatus.FAILED, request.analysisJobId(), null, null);
        return Map.of(
                "analysisJobId", request.analysisJobId(),
                "runId", request.runId(),
                "status", AnalysisJobStatus.FAILED
        );
    }

    private AnalysisJob toCompletedAnalysisJob(AnalyzerCompletedRequest request) {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(request.analysisJobId());
        analysisJob.setRunId(request.runId());
        analysisJob.setStatus(AnalysisJobStatus.COMPLETED);
        analysisJob.setJudgeSchemaVersion(readString(request.judgeResult(), "schema_version", null));
        analysisJob.setAnalyzerVersion(request.analyzerVersion());
        analysisJob.setPromptVersion(request.promptVersion());
        analysisJob.setModelInfoJsonb(toJson(request.modelInfo()));
        analysisJob.setOutputJsonb(toJson(completedOutput(request)));
        analysisJob.setFrictionScore(readFrictionScore(request.judgeResult()));
        analysisJob.setFinishedAt(request.completedAt());
        return analysisJob;
    }

    private AnalysisJob toFailedAnalysisJob(AnalyzerFailedRequest request) {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(request.analysisJobId());
        analysisJob.setRunId(request.runId());
        analysisJob.setStatus(AnalysisJobStatus.FAILED);
        analysisJob.setFinishedAt(request.failedAt());
        analysisJob.setErrorCode(request.errorCode());
        analysisJob.setErrorMessage(request.errorMessage());
        return analysisJob;
    }

    private Map<String, Object> startedResponse(AnalyzerStartedRequest request) {
        return Map.of(
                "analysisJobId", request.analysisJobId(),
                "runId", request.runId(),
                "status", AnalysisJobStatus.RUNNING
        );
    }

    private void validateStartedRunId(AnalyzerStartedRequest request, AnalysisJob existing) {
        if (!request.runId().equals(existing.getRunId())) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Analyzer callback runId does not match analysis job.");
        }
    }

    private boolean isTerminalStatus(AnalysisJobStatus status) {
        return status == AnalysisJobStatus.COMPLETED || status == AnalysisJobStatus.FAILED;
    }

    private Map<String, Object> completedOutput(AnalyzerCompletedRequest request) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("analysisJobId", request.analysisJobId());
        output.put("runId", request.runId());
        output.put("analyzerVersion", request.analyzerVersion());
        output.put("promptVersion", request.promptVersion());
        output.put("modelInfo", request.modelInfo());
        output.put("topFindings", request.topFindings());
        output.put("nudges", request.nudges());
        output.put("judgeResult", request.judgeResult());
        output.put("completedAt", request.completedAt().toString());
        return output;
    }

    private void clearProjectionRows(UUID analysisJobId) {
        nudgeMapper.deleteByAnalysisJobId(analysisJobId);
        analysisFindingMapper.deleteByAnalysisJobId(analysisJobId);
        ruleHitMapper.deleteByAnalysisJobId(analysisJobId);
    }

    private Map<String, UUID> persistIssues(UUID analysisJobId, UUID runId, List<Map<String, Object>> issues) {
        Map<String, UUID> findingIdsByIssueId = new LinkedHashMap<>();
        int rankOrder = FIRST_RANK_ORDER;
        for (Map<String, Object> issue : issues) {
            ruleHitMapper.insert(toRuleHit(analysisJobId, runId, issue));
            AnalysisFinding finding = toAnalysisFinding(analysisJobId, runId, issue, rankOrder);
            analysisFindingMapper.insert(finding);
            putIssueId(findingIdsByIssueId, issue, finding.getId());
            rankOrder += RANK_ORDER_INCREMENT;
        }
        return findingIdsByIssueId;
    }

    private int persistNudges(AnalyzerCompletedRequest request, Map<String, UUID> findingIdsByIssueId) {
        List<Map<String, Object>> nudges = readList(request.judgeResult(), "nudges");
        int rankOrder = FIRST_RANK_ORDER;
        for (Map<String, Object> nudgePayload : nudges) {
            nudgeMapper.insert(toNudge(request.analysisJobId(), nudgePayload, rankOrder, findingIdsByIssueId));
            rankOrder += RANK_ORDER_INCREMENT;
        }
        return nudges.size();
    }

    private RuleHit toRuleHit(UUID analysisJobId, UUID runId, Map<String, Object> issue) {
        RuleHit ruleHit = new RuleHit();
        ruleHit.setId(UUID.randomUUID());
        ruleHit.setAnalysisJobId(analysisJobId);
        ruleHit.setRunId(runId);
        ruleHit.setCriterionId(readString(issue, "criterion_id", "UNKNOWN"));
        ruleHit.setStage(readRequiredStage(issue));
        ruleHit.setAxis(readString(issue, "axis", "UNKNOWN"));
        ruleHit.setSeverity(readInteger(issue, "severity", 0));
        ruleHit.setConfidence(readDecimal(issue, "confidence", BigDecimal.ZERO));
        ruleHit.setPriorityScore(readDecimal(issue, "priority_score", BigDecimal.ZERO));
        ruleHit.setEvidenceLevel(readString(issue, "evidence_level", null));
        ruleHit.setEvidenceRefsJsonb(toJson(readListValue(issue, "evidence_refs")));
        ruleHit.setObservationsJsonb(toJson(readListValue(issue, "observations")));
        ruleHit.setSignalsJsonb(toJson(readListValue(issue, "signals")));
        ruleHit.setExceptionsJsonb(toJson(readListValue(issue, "exceptions_applied")));
        return ruleHit;
    }

    private AnalysisFinding toAnalysisFinding(UUID analysisJobId, UUID runId, Map<String, Object> issue, int rankOrder) {
        AnalysisFinding finding = new AnalysisFinding();
        finding.setId(UUID.randomUUID());
        finding.setAnalysisJobId(analysisJobId);
        finding.setRunId(runId);
        finding.setRankOrder(rankOrder);
        finding.setTitle(readTitle(issue));
        finding.setSummary(readString(issue, "summary", finding.getTitle()));
        finding.setCategory(readString(issue, "category", readString(issue, "criterion_id", "JUDGE_RESULT")));
        finding.setStage(readRequiredStage(issue));
        finding.setAxis(readString(issue, "axis", null));
        finding.setSeverity(readInteger(issue, "severity", null));
        finding.setConfidence(readDecimal(issue, "confidence", null));
        finding.setPriorityScore(readDecimal(issue, "priority_score", null));
        finding.setImpactHypothesis(readString(issue, "impact_hypothesis", null));
        finding.setEvidenceRefsJsonb(toJson(enrichedEvidenceRefs(issue)));
        return finding;
    }

    private List<Object> enrichedEvidenceRefs(Map<String, Object> issue) {
        List<Object> evidenceRefs = readListValue(issue, "evidence_refs");
        Map<String, Map<String, Object>> componentsByRef = problemComponentsByRef(issue);
        if (evidenceRefs.isEmpty() || componentsByRef.isEmpty()) {
            return evidenceRefs;
        }

        return evidenceRefs.stream()
                .map(ref -> enrichEvidenceRef(ref, componentsByRef))
                .toList();
    }

    private Map<String, Map<String, Object>> problemComponentsByRef(Map<String, Object> issue) {
        Map<String, Map<String, Object>> componentsByRef = new LinkedHashMap<>();
        for (Map<String, Object> component : readList(issue, "problem_components")) {
            String evidenceRef = readString(component, "evidence_ref", null);
            if (evidenceRef != null && hasUsableProblemComponent(component)) {
                componentsByRef.put(evidenceRef, component);
            }
        }

        if (!componentsByRef.isEmpty()) {
            return componentsByRef;
        }

        for (Map<String, Object> location : readList(issue, "evidence_locations")) {
            for (Map<String, Object> component : readList(location, "problem_components")) {
                String evidenceRef = readString(component, "evidence_ref", readString(location, "evidence_ref", null));
                if (evidenceRef == null) {
                    continue;
                }
                Map<String, Object> canonicalComponent = canonicalProblemComponent(component, location, evidenceRef);
                if (hasUsableProblemComponent(canonicalComponent)) {
                    componentsByRef.put(evidenceRef, canonicalComponent);
                }
            }
        }
        return componentsByRef;
    }

    private boolean hasUsableProblemComponent(Map<String, Object> component) {
        return readString(component, "screenshot_artifact_id", null) != null
                && !readMap(component, "bounding_box").isEmpty();
    }

    private Map<String, Object> canonicalProblemComponent(
            Map<String, Object> component,
            Map<String, Object> location,
            String evidenceRef
    ) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("evidence_ref", evidenceRef);
        result.put("label", readString(component, "label", readString(component, "text", null)));
        result.put("role", readString(component, "role", null));
        result.put("text", readString(component, "text", null));
        result.put("selector", readString(component, "selector", null));
        result.put("coordinate_space", readString(component, "coordinate_space", "viewport"));
        result.put("bounding_box", readMap(component, "bounding_box").isEmpty() ? readMap(component, "bounds") : readMap(component, "bounding_box"));
        result.put("viewport", readMap(component, "viewport").isEmpty() ? readMap(location, "viewport") : readMap(component, "viewport"));
        String screenshotArtifactId = normalizeArtifactRef(readString(
                component,
                "screenshot_artifact_id",
                readString(location, "screenshot_artifact_id", null)
        ));
        if (screenshotArtifactId != null) {
            result.put("screenshot_artifact_id", screenshotArtifactId);
        }
        return result;
    }

    private String normalizeArtifactRef(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.startsWith("artifact:") ? value.substring("artifact:".length()) : value;
    }

    private Object enrichEvidenceRef(Object ref, Map<String, Map<String, Object>> componentsByRef) {
        String refId = evidenceRefId(ref);
        Map<String, Object> component = refId == null ? null : componentsByRef.get(refId);
        if (component == null) {
            return ref;
        }

        Map<String, Object> enriched = new LinkedHashMap<>();
        if (ref instanceof Map<?, ?> refMap) {
            refMap.forEach((key, value) -> enriched.put(String.valueOf(key), value));
        } else {
            enriched.put("ref", refId);
        }
        enriched.put("problemComponent", component);
        return enriched;
    }

    private String evidenceRefId(Object ref) {
        if (ref instanceof String text && !text.isBlank()) {
            return text;
        }

        if (ref instanceof Map<?, ?> map) {
            for (String key : List.of("ref", "id", "reference", "observationId", "observation_id")) {
                Object value = map.get(key);
                if (value instanceof String text && !text.isBlank()) {
                    return text;
                }
            }
        }

        return null;
    }

    private Nudge toNudge(UUID analysisJobId, Map<String, Object> payload, int rankOrder, Map<String, UUID> findingIdsByIssueId) {
        Nudge nudge = new Nudge();
        nudge.setId(UUID.randomUUID());
        nudge.setAnalysisJobId(analysisJobId);
        nudge.setFindingId(findingIdsByIssueId.get(readString(payload, "issue_id", "")));
        nudge.setRankOrder(rankOrder);
        nudge.setTitle(readString(payload, "title", "Improvement suggestion"));
        nudge.setRationale(readString(payload, "rationale", "Generated from JudgeResult evidence."));
        nudge.setRecommendation(readString(payload, "recommendation", "Adjust the UI flow to reduce observed friction."));
        nudge.setDifficulty(readDifficulty(payload));
        nudge.setExpectedEffect(readString(payload, "expected_effect", null));
        nudge.setValidationQuestion(readString(payload, "validation_question", null));
        return nudge;
    }

    private Map<String, Object> completedResponse(AnalyzerCompletedRequest request, int issueCount, int nudgeCount) {
        return Map.of(
                "analysisJobId", request.analysisJobId(),
                "runId", request.runId(),
                "status", AnalysisJobStatus.COMPLETED,
                "issueCount", issueCount,
                "nudgeCount", nudgeCount
        );
    }

    private void putIssueId(Map<String, UUID> findingIdsByIssueId, Map<String, Object> issue, UUID findingId) {
        String issueId = readString(issue, "issue_id", null);
        if (issueId != null) {
            findingIdsByIssueId.put(issueId, findingId);
        }
    }

    private BigDecimal readFrictionScore(Map<String, Object> judgeResult) {
        return readDecimal(readMap(judgeResult, "summary"), "friction_score", null);
    }

    private void validateIssueStages(List<Map<String, Object>> issues) {
        for (Map<String, Object> issue : issues) {
            readRequiredStage(issue);
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> readList(Map<String, Object> payload, String key) {
        return readListValue(payload, key).stream()
                .filter(Map.class::isInstance)
                .map(item -> (Map<String, Object>) item)
                .toList();
    }

    private List<Object> readListValue(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (value instanceof List<?> list) {
            return List.copyOf(list);
        }
        return List.of();
    }

    private Map<String, Object> readMap(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((mapKey, mapValue) -> result.put(String.valueOf(mapKey), mapValue));
            return result;
        }
        return Map.of();
    }

    private String readTitle(Map<String, Object> issue) {
        return readString(issue, "title", readString(issue, "summary", readString(issue, "criterion_id", "JudgeResult finding")));
    }

    private String readStage(Map<String, Object> payload) {
        String stage = readString(payload, "stage", null);
        if (stage == null) {
            return null;
        }
        return VALID_STAGES.contains(stage) ? stage : null;
    }

    private String readRequiredStage(Map<String, Object> payload) {
        String stage = readStage(payload);
        if (stage == null) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "JudgeResult issue stage is required.");
        }
        return stage;
    }

    private String readDifficulty(Map<String, Object> payload) {
        String difficulty = readString(payload, "difficulty", null);
        return VALID_DIFFICULTIES.contains(difficulty) ? difficulty : null;
    }

    private String readString(Map<String, Object> payload, String key, String defaultValue) {
        Object value = payload.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        return defaultValue;
    }

    private Integer readInteger(Map<String, Object> payload, String key, Integer defaultValue) {
        Object value = payload.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return defaultValue;
    }

    private BigDecimal readDecimal(Map<String, Object> payload, String key, BigDecimal defaultValue) {
        Object value = payload.get(key);
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue());
        }
        return defaultValue;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "JudgeResult payload cannot be serialized.", null, exception);
        }
    }
}
