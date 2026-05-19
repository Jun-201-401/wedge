package com.wedge.report.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.application.ArtifactContentWriter;
import com.wedge.evidence.application.ArtifactPersistenceService;
import com.wedge.evidence.application.command.SaveRunArtifactCommand;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.report.api.dto.ReportCreateRequest;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportExportResponse;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.report.infrastructure.ReportMapper;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.application.RunService;
import com.wedge.run.domain.ReportStatus;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@RequiredArgsConstructor
public class ReportExportService {
    private static final String EXPORT_CONTENT_VERSION = "screen-v8";
    private static final String MARKDOWN_MIME_TYPE = "text/markdown; charset=utf-8";
    private static final String PDF_MIME_TYPE = "application/pdf";

    private final RunService runService;
    private final ReportAccessGuard reportAccessGuard;
    private final ReportMapper reportMapper;
    private final ArtifactMapper artifactMapper;
    private final ArtifactPersistenceService artifactPersistenceService;
    private final ArtifactContentWriter artifactContentWriter;
    private final ReportDetailQueryService reportDetailQueryService;
    private final ReportMarkdownRenderer reportMarkdownRenderer;
    private final ReportPdfRenderer reportPdfRenderer;
    private final Clock clock;
    private final TransactionTemplate transactionTemplate;

    @Value("${wedge.artifacts.bucket:}")
    private String defaultBucket;

    public ReportExportResponse createRunReportExport(UUID runId, UUID userId, ReportCreateRequest request) {
        if (request.format() != ReportFormat.MARKDOWN && request.format() != ReportFormat.PDF) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Only Markdown and PDF report export are currently supported.");
        }

        RunResponse run = runService.getRun(runId);
        reportAccessGuard.ensureProjectAccessible(run.projectId(), userId);
        Report report = findReadyReport(runId, request.analysisJobId());
        UUID exportArtifactId = exportArtifactId(report.getId(), request.format());
        return artifactMapper.findByRunIdAndId(runId, exportArtifactId)
                .map(artifact -> response(report, artifact, request.format()))
                .orElseGet(() -> renderAndCreateArtifact(run, report, userId, exportArtifactId, request.format()));
    }

    private Report findReadyReport(UUID runId, UUID analysisJobId) {
        List<Report> reports = reportMapper.findByRunId(runId);
        Report report = reports.stream()
                .filter(candidate -> analysisJobId == null || analysisJobId.equals(candidate.getAnalysisJobId()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.STATE_CONFLICT, "Ready report is required before report export."));
        if (report.getStatus() != ReportStatus.READY) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Only ready reports can be exported.");
        }
        if (report.getAnalysisJobId() == null) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "Report analysis job is required before report export.");
        }
        return report;
    }

    private ReportExportResponse renderAndCreateArtifact(RunResponse run, Report report, UUID userId, UUID artifactId, ReportFormat format) {
        ReportDetailResponse detail = reportDetailQueryService.getReportDetail(report.getId(), userId);
        byte[] content = render(detail, run, format);
        return transactionTemplate.execute(status -> artifactMapper.findByRunIdAndId(run.id(), artifactId)
                .map(artifact -> response(report, artifact, format))
                .orElseGet(() -> createArtifact(run, report, artifactId, format, content)));
    }

    private ReportExportResponse createArtifact(RunResponse run, Report report, UUID artifactId, ReportFormat format, byte[] content) {
        OffsetDateTime createdAt = OffsetDateTime.now(clock);
        SaveRunArtifactCommand artifactCommand = new SaveRunArtifactCommand(
                artifactId,
                "reports",
                artifactType(format),
                artifactBucket(),
                artifactKey(run.id(), report.getId(), artifactId, format),
                mimeType(format),
                null,
                null,
                content.length,
                sha256(content),
                createdAt
        );
        Artifact artifact = toArtifact(run.id(), artifactCommand);
        artifactContentWriter.save(artifact, content);
        artifactPersistenceService.saveRunArtifacts(run.id(), new SaveRunArtifactsCommand(List.of(artifactCommand)));
        return response(report, artifact, format);
    }

    private byte[] render(ReportDetailResponse detail, RunResponse run, ReportFormat format) {
        return switch (format) {
            case MARKDOWN -> reportMarkdownRenderer.render(detail, run);
            case PDF -> reportPdfRenderer.render(detail, run);
            default -> throw new BusinessException(ErrorCode.INVALID_REQUEST, "Unsupported report export format.");
        };
    }

    private ArtifactType artifactType(ReportFormat format) {
        return switch (format) {
            case MARKDOWN -> ArtifactType.REPORT_MARKDOWN;
            case PDF -> ArtifactType.REPORT_PDF;
            default -> throw new BusinessException(ErrorCode.INVALID_REQUEST, "Unsupported report export format.");
        };
    }

    private String mimeType(ReportFormat format) {
        return switch (format) {
            case MARKDOWN -> MARKDOWN_MIME_TYPE;
            case PDF -> PDF_MIME_TYPE;
            default -> throw new BusinessException(ErrorCode.INVALID_REQUEST, "Unsupported report export format.");
        };
    }

    private Artifact toArtifact(UUID runId, SaveRunArtifactCommand command) {
        Artifact artifact = new Artifact();
        artifact.setId(command.artifactId());
        artifact.setRunId(runId);
        artifact.setArtifactType(command.artifactType());
        artifact.setS3Bucket(command.bucket());
        artifact.setS3Key(command.key());
        artifact.setMimeType(command.mimeType());
        artifact.setWidth(command.width());
        artifact.setHeight(command.height());
        artifact.setSizeBytes(command.sizeBytes());
        artifact.setSha256(command.sha256());
        artifact.setCapturedAt(command.createdAt());
        artifact.setCreatedAt(command.createdAt());
        return artifact;
    }

    private ReportExportResponse response(Report report, Artifact artifact, ReportFormat format) {
        return new ReportExportResponse(
                report.getId(),
                report.getRunId(),
                report.getAnalysisJobId(),
                format,
                ReportStatus.READY,
                artifact.getId(),
                ArtifactResponse.contentUrl(artifact),
                artifact.getCreatedAt()
        );
    }

    private String artifactKey(UUID runId, UUID reportId, UUID artifactId, ReportFormat format) {
        return runId + "/reports/" + reportId + "-" + artifactId + extension(format);
    }

    private String extension(ReportFormat format) {
        return switch (format) {
            case MARKDOWN -> ".md";
            case PDF -> ".pdf";
            default -> throw new BusinessException(ErrorCode.INVALID_REQUEST, "Unsupported report export format.");
        };
    }

    private String artifactBucket() {
        return defaultBucket == null || defaultBucket.isBlank() ? "local-runner" : defaultBucket;
    }

    private UUID exportArtifactId(UUID reportId, ReportFormat format) {
        return UUID.nameUUIDFromBytes(("report-export:" + EXPORT_CONTENT_VERSION + ":" + reportId + ":" + format).getBytes(StandardCharsets.UTF_8));
    }

    private String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 algorithm is not available.", exception);
        }
    }
}
