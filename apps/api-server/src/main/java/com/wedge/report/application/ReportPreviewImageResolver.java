package com.wedge.report.application;

import com.wedge.analysis.domain.AnalysisFinding;
import com.wedge.evidence.api.dto.ArtifactResponse;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import com.wedge.report.api.dto.ReportPreviewImageResponse;
import com.wedge.report.domain.Report;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ReportPreviewImageResolver {
    private static final String STAGE_SCREENSHOT = "STAGE_SCREENSHOT";
    private static final String REPORT_ARTIFACT = "REPORT_ARTIFACT";
    private static final String LATEST_SCREENSHOT = "LATEST_SCREENSHOT";

    private final ArtifactMapper artifactMapper;

    public ReportPreviewImageResponse resolve(Report report, AnalysisFinding finding) {
        return stageScreenshot(report.getRunId(), finding.getStage())
                .or(() -> reportScreenshot(report))
                .or(() -> latestScreenshot(report.getRunId()))
                .orElse(null);
    }

    public DetailPreviewContext detailContext(Report report) {
        return new DetailPreviewContext(
                new HashMap<>(),
                reportScreenshot(report),
                latestScreenshot(report.getRunId())
        );
    }

    public ReportPreviewImageResponse resolve(
            Report report,
            AnalysisFinding finding,
            DetailPreviewContext context
    ) {
        Optional<ReportPreviewImageResponse> stagePreview = context.stagePreviews().computeIfAbsent(
                finding.getStage(),
                stage -> stageScreenshot(report.getRunId(), stage)
        );
        return stagePreview
                .or(context::reportPreview)
                .or(context::latestPreview)
                .orElse(null);
    }

    private Optional<ReportPreviewImageResponse> stageScreenshot(UUID runId, String stage) {
        if (stage == null || stage.isBlank()) {
            return Optional.empty();
        }
        return artifactMapper.findLatestScreenshotByRunIdAndStage(runId, stage)
                .map(artifact -> previewImage(artifact, STAGE_SCREENSHOT));
    }

    private Optional<ReportPreviewImageResponse> reportScreenshot(Report report) {
        if (report.getArtifactId() == null) {
            return Optional.empty();
        }
        return artifactMapper.findByRunIdAndId(report.getRunId(), report.getArtifactId())
                .filter(artifact -> artifact.getArtifactType() == ArtifactType.SCREENSHOT)
                .map(artifact -> previewImage(artifact, REPORT_ARTIFACT));
    }

    private Optional<ReportPreviewImageResponse> latestScreenshot(UUID runId) {
        return artifactMapper.findLatestScreenshotByRunId(runId)
                .map(artifact -> previewImage(artifact, LATEST_SCREENSHOT));
    }

    private ReportPreviewImageResponse previewImage(Artifact artifact, String source) {
        return new ReportPreviewImageResponse(ArtifactResponse.from(artifact), source);
    }

    public record DetailPreviewContext(
            Map<String, Optional<ReportPreviewImageResponse>> stagePreviews,
            Optional<ReportPreviewImageResponse> reportPreview,
            Optional<ReportPreviewImageResponse> latestPreview
    ) {
    }
}
