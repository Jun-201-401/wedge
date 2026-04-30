package com.wedge.analysis.application;

import com.wedge.analysis.api.dto.AnalysisRequestResponse;
import com.wedge.analysis.domain.AnalysisJob;
import com.wedge.analysis.infrastructure.AnalysisJobMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.evidence.domain.EvidencePacketSnapshot;
import com.wedge.project.application.ProjectAccessService;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.AnalysisJobStatus;
import com.wedge.run.domain.RunStatus;
import com.wedge.run.infrastructure.OutboxMessagePersistenceAdapter;
import com.wedge.run.infrastructure.RunMapper;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnalysisRequestService {
    private static final String MESSAGE_TYPE = "analysis.request";
    private static final String SCHEMA_VERSION = "0.5";
    private static final String PRODUCER = "spring-api";
    private static final String PRIMARY_ANALYSIS = "PRIMARY";

    private final RunService runService;
    private final ProjectAccessService projectAccessService;
    private final EvidenceService evidenceService;
    private final AnalysisJobMapper analysisJobMapper;
    private final RunMapper runMapper;
    private final OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;
    private final ApplicationEventPublisher applicationEventPublisher;

    public AnalysisRequestService(
            RunService runService,
            ProjectAccessService projectAccessService,
            EvidenceService evidenceService,
            AnalysisJobMapper analysisJobMapper,
            RunMapper runMapper,
            OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter,
            ApplicationEventPublisher applicationEventPublisher
    ) {
        this.runService = runService;
        this.projectAccessService = projectAccessService;
        this.evidenceService = evidenceService;
        this.analysisJobMapper = analysisJobMapper;
        this.runMapper = runMapper;
        this.outboxMessagePersistenceAdapter = outboxMessagePersistenceAdapter;
        this.applicationEventPublisher = applicationEventPublisher;
    }

    @Transactional
    public AnalysisRequestResponse requestPrimaryAnalysis(UUID runId, UUID userId) {
        RunResponse run = runService.getRun(runId);
        projectAccessService.ensureProjectAccessible(run.projectId(), userId);
        if (run.status() != RunStatus.COMPLETED) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Run must be COMPLETED before analysis can be requested.");
        }

        EvidencePacketSnapshot evidencePacket = evidenceService.materializeRunEvidencePacketSnapshot(runId);
        UUID analysisJobId = UUID.randomUUID();
        AnalysisJob analysisJob = queuedAnalysisJob(analysisJobId, runId, evidencePacket.getId());
        analysisJobMapper.insertQueued(analysisJob);
        runMapper.markAnalysisQueued(runId, analysisJobId);

        AnalysisRequestMessage message = createMessage(analysisJobId, runId, evidencePacket.getId());
        UUID outboxMessageId = outboxMessagePersistenceAdapter.appendAnalysisRequestMessage(message, analysisJobId);
        applicationEventPublisher.publishEvent(new AnalysisRequestOutboxEnqueuedEvent(outboxMessageId));

        return new AnalysisRequestResponse(
                analysisJobId,
                runId,
                AnalysisJobStatus.QUEUED.name(),
                PRIMARY_ANALYSIS,
                evidencePacket.getId(),
                false,
                evidencePacket.getCheckpointCount(),
                evidencePacket.getArtifactCount()
        );
    }

    private AnalysisJob queuedAnalysisJob(UUID analysisJobId, UUID runId, UUID evidencePacketId) {
        AnalysisJob analysisJob = new AnalysisJob();
        analysisJob.setId(analysisJobId);
        analysisJob.setRunId(runId);
        analysisJob.setJobType(PRIMARY_ANALYSIS);
        analysisJob.setStatus(AnalysisJobStatus.QUEUED);
        analysisJob.setEvidencePacketId(evidencePacketId);
        return analysisJob;
    }

    private AnalysisRequestMessage createMessage(UUID analysisJobId, UUID runId, UUID evidencePacketId) {
        String messageId = UUID.randomUUID().toString();
        String createdAt = OffsetDateTime.now().toString();
        Map<String, Object> payload = Map.of(
                "analysisJobId", analysisJobId.toString(),
                "runId", runId.toString(),
                "analysisType", PRIMARY_ANALYSIS,
                "forceRebuildEvidenceBundle", false,
                "evidencePacketId", evidencePacketId.toString()
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

}
