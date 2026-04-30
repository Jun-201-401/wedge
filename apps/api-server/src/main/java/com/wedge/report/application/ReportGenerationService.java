package com.wedge.report.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.infrastructure.AnalysisFindingMapper;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.analysis.infrastructure.NudgeMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.report.api.dto.ReportFindingResponse;
import com.wedge.report.api.dto.ReportNudgeResponse;
import com.wedge.report.api.dto.RunReportResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ReportStatus;
import com.wedge.run.infrastructure.RunMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReportGenerationService {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};
    private static final String READY = "READY";
    private static final String GENERATABLE = "GENERATABLE";
    private static final String NOT_READY = "NOT_READY";
    private static final String FAILED = "FAILED";

    private final RunService runService;
    private final AnalysisJobMapper analysisJobMapper;
    private final AnalysisFindingMapper analysisFindingMapper;
    private final NudgeMapper nudgeMapper;
    private final ReportMapper reportMapper;
    private final RunMapper runMapper;
    private final ObjectMapper objectMapper;

    public ReportGenerationService(
            RunService runService,
            AnalysisJobMapper analysisJobMapper,
            AnalysisFindingMapper analysisFindingMapper,
            NudgeMapper nudgeMapper,
            ReportMapper reportMapper,
            RunMapper runMapper,
            ObjectMapper objectMapper
    ) {
        this.runService = runService;
        this.analysisJobMapper = analysisJobMapper;
        this.analysisFindingMapper = analysisFindingMapper;
        this.nudgeMapper = nudgeMapper;
        this.reportMapper = reportMapper;
        this.runMapper = runMapper;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public RunReportResponse getRunReport(UUID runId) {
        RunResponse run = runService.getRun(runId);
        List<Report> reports = reportMapper.findByRunId(runId);
        return analysisJobMapper.findLatestByRunId(runId)
                .map(job -> responseForLatestAnalysis(run, job, reports))
                .orElseGet(() -> reports.isEmpty() ? emptyResponse(run) : readyResponse(runId, reports.get(0)));
    }

    @Transactional
    public RunReportResponse generateRunReport(UUID runId) {
        runService.getRun(runId);
        AnalysisJob analysisJob = analysisJobMapper.findLatestCompletedByRunId(runId)
                .orElseThrow(() -> new BusinessException(ErrorCode.STATE_CONFLICT, "Completed analysis result is required before report generation."));

        List<Report> existingReports = reportMapper.findByRunId(runId);
        Report existingReport = findReportForAnalysis(existingReports, analysisJob.getId());
        if (existingReport != null) {
            runMapper.updateLatestReport(runId, existingReport.getId());
            return readyResponse(runId, existingReport);
        }

        Report report = toReport(analysisJob);
        reportMapper.insert(report);
        runMapper.updateAnalysisState(runId, AnalysisStatus.COMPLETED, analysisJob.getId(), analysisJob.getFrictionScore(), report.getId());
        return readyResponse(runId, report);
    }

    private RunReportResponse responseForLatestAnalysis(RunResponse run, AnalysisJob analysisJob, List<Report> reports) {
        Report report = findReportForAnalysis(reports, analysisJob.getId());
        if (report != null) {
            return readyResponse(run.id(), report);
        }
        return responseWithoutReport(run, analysisJob);
    }

    private Report findReportForAnalysis(List<Report> reports, UUID analysisJobId) {
        return reports.stream()
                .filter(report -> analysisJobId.equals(report.getAnalysisJobId()))
                .findFirst()
                .orElse(null);
    }

    private Report toReport(AnalysisJob analysisJob) {
        Map<String, Object> output = readJsonMap(analysisJob.getOutputJsonb());
        Map<String, Object> judgeResult = asMap(output.get("judgeResult"));
        Report report = new Report();
        report.setId(UUID.randomUUID());
        report.setRunId(analysisJob.getRunId());
        report.setAnalysisJobId(analysisJob.getId());
        report.setTitle("JudgeResult analysis report");
        report.setFormat(ReportFormat.JSON);
        report.setStatus(ReportStatus.READY);
        report.setSummaryJsonb(writeJson(asMap(judgeResult.get("summary"))));
        report.setDecisionMapJsonb(writeJson(asList(judgeResult.get("decision_map"))));
        return report;
    }

    private RunReportResponse readyResponse(UUID runId, Report report) {
        return new RunReportResponse(
                runId,
                READY,
                AnalysisJobStatus.COMPLETED.name(),
                report.getAnalysisJobId(),
                report.getId(),
                report.getTitle(),
                report.getFormat(),
                report.getStatus(),
                readJsonNode(report.getSummaryJsonb(), true),
                readJsonNode(report.getDecisionMapJsonb(), false),
                findings(report.getAnalysisJobId()),
                nudges(report.getAnalysisJobId()),
                null,
                null,
                report.getCreatedAt(),
                report.getUpdatedAt()
        );
    }

    private RunReportResponse responseWithoutReport(RunResponse run, AnalysisJob analysisJob) {
        if (analysisJob.getStatus() == AnalysisJobStatus.COMPLETED) {
            return statusResponse(run.id(), GENERATABLE, analysisJob.getStatus().name(), analysisJob.getId(), null, null);
        }
        if (analysisJob.getStatus() == AnalysisJobStatus.FAILED) {
            return statusResponse(run.id(), FAILED, analysisJob.getStatus().name(), analysisJob.getId(), analysisJob.getErrorCode(), analysisJob.getErrorMessage());
        }
        return statusResponse(run.id(), NOT_READY, analysisJob.getStatus().name(), analysisJob.getId(), null, null);
    }

    private RunReportResponse emptyResponse(RunResponse run) {
        return statusResponse(run.id(), NOT_READY, run.analysisStatus().name(), null, null, null);
    }

    private RunReportResponse statusResponse(
            UUID runId,
            String reportStatus,
            String analysisStatus,
            UUID analysisJobId,
            String errorCode,
            String errorMessage
    ) {
        return new RunReportResponse(
                runId,
                reportStatus,
                analysisStatus,
                analysisJobId,
                null,
                null,
                null,
                null,
                objectMapper.createObjectNode(),
                objectMapper.createArrayNode(),
                List.of(),
                List.of(),
                errorCode,
                errorMessage,
                null,
                null
        );
    }

    private List<ReportFindingResponse> findings(UUID analysisJobId) {
        if (analysisJobId == null) {
            return List.of();
        }
        return analysisFindingMapper.findByAnalysisJobId(analysisJobId).stream()
                .map(finding -> ReportFindingResponse.from(finding, readJsonNode(finding.getEvidenceRefsJsonb(), false)))
                .toList();
    }

    private List<ReportNudgeResponse> nudges(UUID analysisJobId) {
        if (analysisJobId == null) {
            return List.of();
        }
        return nudgeMapper.findByAnalysisJobId(analysisJobId).stream()
                .map(ReportNudgeResponse::from)
                .toList();
    }

    private Map<String, Object> readJsonMap(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(rawJson, MAP_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored analysis output JSON is invalid", exception);
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Report projection cannot be serialized", exception);
        }
    }

    private JsonNode readJsonNode(String rawJson, boolean objectFallback) {
        if (rawJson == null || rawJson.isBlank()) {
            return objectFallback ? objectMapper.createObjectNode() : objectMapper.createArrayNode();
        }
        try {
            return objectMapper.readTree(rawJson);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored report JSON is invalid", exception);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private List<?> asList(Object value) {
        return value instanceof List<?> list ? list : List.of();
    }
}
