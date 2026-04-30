package com.wedge.analysis.application;

import com.wedge.analysis.api.dto.AnalysisRequestResponse;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.RunMapper;
import com.wedge.run.application.RunService;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnalysisRequestService {
    private static final String MESSAGE_TYPE = "analysis.request";
    private static final String SCHEMA_VERSION = "0.5";
    private static final String PRODUCER = "spring-api";
    private static final String PRIMARY_ANALYSIS = "PRIMARY";

    private final RunService runService;
    private final EvidenceService evidenceService;
    private final AnalysisJobMapper analysisJobMapper;
    private final RunMapper runMapper;
    private final AnalysisRequestPublisher analysisRequestPublisher;

    public AnalysisRequestService(
            RunService runService,
            EvidenceService evidenceService,
            AnalysisJobMapper analysisJobMapper,
            RunMapper runMapper,
            AnalysisRequestPublisher analysisRequestPublisher
    ) {
        this.runService = runService;
        this.evidenceService = evidenceService;
        this.analysisJobMapper = analysisJobMapper;
        this.runMapper = runMapper;
        this.analysisRequestPublisher = analysisRequestPublisher;
    }

    @Transactional
    public AnalysisRequestResponse requestPrimaryAnalysis(UUID runId) {
        RunResponse run = runService.getRun(runId);
        if (run.status() != RunStatus.COMPLETED) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Run must be COMPLETED before analysis can be requested.");
        }

        Map<String, Object> evidencePacket = evidenceService.getRunEvidencePacket(runId);
        UUID analysisJobId = UUID.randomUUID();
        AnalysisJob analysisJob = queuedAnalysisJob(analysisJobId, runId);
        analysisJobMapper.insertQueued(analysisJob);
        runMapper.updateAnalysisState(runId, AnalysisStatus.QUEUED, analysisJobId, null, null);

        AnalysisRequestMessage message = createMessage(analysisJobId, runId, evidencePacket);
        analysisRequestPublisher.publish(message);

        return new AnalysisRequestResponse(
                analysisJobId,
                runId,
                AnalysisJobStatus.QUEUED.name(),
                PRIMARY_ANALYSIS,
                true,
                sizeOfList(evidencePacket.get("checkpoints")),
                sizeOfList(evidencePacket.get("artifacts"))
        );
    }

    private AnalysisJob queuedAnalysisJob(UUID analysisJobId, UUID runId) {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(analysisJobId);
        analysisJob.setRunId(runId);
        analysisJob.setJobType(PRIMARY_ANALYSIS);
        analysisJob.setStatus(AnalysisJobStatus.QUEUED);
        return analysisJob;
    }

    private AnalysisRequestMessage createMessage(UUID analysisJobId, UUID runId, Map<String, Object> evidencePacket) {
        String messageId = UUID.randomUUID().toString();
        String createdAt = OffsetDateTime.now().toString();
        Map<String, Object> payload = Map.of(
                "analysisJobId", analysisJobId.toString(),
                "runId", runId.toString(),
                "analysisType", PRIMARY_ANALYSIS,
                "forceRebuildEvidenceBundle", false,
                "evidencePacket", evidencePacket
        );
        return new AnalysisRequestMessage(
                messageId,
                MESSAGE_TYPE,
                SCHEMA_VERSION,
                createdAt,
                PRODUCER,
                runId.toString(),
                "analysis:" + analysisJobId,
                payload
        );
    }

    private int sizeOfList(Object value) {
        return value instanceof List<?> list ? list.size() : 0;
    }
}
