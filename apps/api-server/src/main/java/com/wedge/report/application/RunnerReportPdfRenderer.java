package com.wedge.report.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.run.api.dto.RunResponse;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.imageio.ImageIO;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class RunnerReportPdfRenderer implements ReportPdfRenderer {
    private static final byte[] PDF_HEADER = "%PDF-".getBytes(StandardCharsets.US_ASCII);
    private static final int MAX_IMAGE_COUNT = 20;
    private static final long MAX_TOTAL_IMAGE_BYTES = 15L * 1024L * 1024L;

    private final ReportDownloadDocumentBuilder documentBuilder;
    private final EvidenceService evidenceService;
    private final ObjectMapper objectMapper;

    @Value("${wedge.report.pdf.renderer.base-url:http://localhost:9102}")
    private String rendererBaseUrl;

    @Value("${wedge.report.pdf.renderer.timeout-ms:30000}")
    private long timeoutMs;

    @Value("${wedge.report.pdf.renderer.auth-token:}")
    private String authToken;

    @Override
    public byte[] render(ReportDetailResponse report, RunResponse run) {
        ReportDownloadDocument document = documentBuilder.build(report, run);
        ReportPdfRenderPayload payload = new ReportPdfRenderPayload(document, candidateImages(document));
        byte[] pdf = requestPdf(payload);
        if (!startsWith(pdf, PDF_HEADER)) {
            throw new IllegalStateException("PDF renderer returned non-PDF content.");
        }
        return pdf;
    }

    private List<ReportPdfCandidateImage> candidateImages(ReportDownloadDocument document) {
        List<ReportPdfCandidateImage> images = new ArrayList<>();
        Map<String, ReportPdfProblemImage> imagesByArtifactId = new HashMap<>();
        ImageBudget imageBudget = new ImageBudget();
        for (ReportDownloadCandidate candidate : document.candidates()) {
            String artifactKey = screenshotArtifactKey(candidate.location());
            if (artifactKey == null) {
                continue;
            }

            ReportPdfProblemImage image = imagesByArtifactId.computeIfAbsent(
                    artifactKey,
                    ignored -> problemImage(document.runId(), candidate, imageBudget)
            );
            images.add(new ReportPdfCandidateImage(candidate.order(), image));
        }
        return images;
    }

    private String screenshotArtifactKey(ReportDownloadProblemLocation location) {
        if (location == null || location.screenshotArtifactId() == null || location.screenshotArtifactId().isBlank()) {
            return null;
        }
        return location.screenshotArtifactId().trim();
    }

    private ReportPdfProblemImage problemImage(UUID runId, ReportDownloadCandidate candidate, ImageBudget imageBudget) {
        ReportDownloadProblemLocation location = candidate.location();
        UUID artifactId = parseUuid(location.screenshotArtifactId());
        try {
            EvidenceService.ArtifactContent content = evidenceService.getRunImageArtifactContent(runId, artifactId);
            byte[] imageBytes = content.resource().getInputStream().readAllBytes();
            imageBudget.accept(imageBytes.length);
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (image == null) {
                throw new IllegalStateException("PDF screenshot artifact is not a readable image: " + artifactId);
            }

            ReportPdfMarker marker = marker(location.geometry(), image.getWidth(), image.getHeight())
                    .orElseThrow(() -> new IllegalStateException("PDF screenshot highlight geometry is required for artifact: " + artifactId));
            ReportPdfCrop crop = crop(marker, image.getWidth(), image.getHeight());
            String mimeType = content.mimeType() == null || content.mimeType().isBlank() ? "image/png" : content.mimeType();
            String dataUri = "data:" + mimeType + ";base64," + Base64.getEncoder().encodeToString(imageBytes);
            return new ReportPdfProblemImage(
                    "문제 위치 스냅샷",
                    mimeType,
                    dataUri,
                    image.getWidth(),
                    image.getHeight(),
                    crop,
                    marker
            );
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to load PDF screenshot artifact for candidate " + candidate.order() + ": " + artifactId, exception);
        }
    }

    private byte[] requestPdf(ReportPdfRenderPayload payload) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .build();
        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(renderEndpoint())
                .timeout(Duration.ofMillis(timeoutMs))
                .header("Content-Type", "application/json")
                .header("Accept", "application/pdf")
                .POST(HttpRequest.BodyPublishers.ofString(toJson(payload), StandardCharsets.UTF_8));
        if (authToken != null && !authToken.isBlank()) {
            requestBuilder.header("Authorization", "Bearer " + authToken);
        }

        try {
            HttpResponse<byte[]> response = httpClient.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("PDF renderer failed with HTTP " + response.statusCode() + ": " + responseBody(response.body()));
            }
            return response.body();
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to call PDF renderer.", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("PDF renderer request was interrupted.", exception);
        }
    }

    private URI renderEndpoint() {
        String normalizedBaseUrl = rendererBaseUrl == null || rendererBaseUrl.isBlank()
                ? "http://localhost:9102"
                : rendererBaseUrl.replaceAll("/+$", "");
        return URI.create(normalizedBaseUrl + "/internal/report-pdf/render");
    }

    private String toJson(ReportPdfRenderPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize PDF render payload.", exception);
        }
    }

    private String responseBody(byte[] body) {
        if (body == null || body.length == 0) {
            return "";
        }
        String text = new String(body, StandardCharsets.UTF_8).trim();
        return text.length() > 500 ? text.substring(0, 500) : text;
    }

    private Optional<ReportPdfMarker> marker(ReportDownloadLocationGeometry geometry, int imageWidth, int imageHeight) {
        if (geometry == null || geometry.x() == null || geometry.y() == null || geometry.width() == null || geometry.height() == null) {
            return Optional.empty();
        }

        double x = geometry.x().doubleValue();
        double y = geometry.y().doubleValue();
        double width = geometry.width().doubleValue();
        double height = geometry.height().doubleValue();
        if (x < 0 || y < 0 || width <= 0 || height <= 0) {
            return Optional.empty();
        }

        String unit = geometry.unit() == null || geometry.unit().isBlank() ? "css_px" : geometry.unit();
        if ("viewport_ratio".equals(unit)) {
            return Optional.of(clampMarker(x * imageWidth, y * imageHeight, width * imageWidth, height * imageHeight, imageWidth, imageHeight));
        }

        if ("screenshot_px".equals(unit)) {
            return Optional.of(clampMarker(x, y, width, height, imageWidth, imageHeight));
        }

        double viewportWidth = positiveOrDefault(geometry.viewportWidth(), imageWidth);
        double viewportHeight = positiveOrDefault(geometry.viewportHeight(), imageHeight);
        double scale = imageWidth / viewportWidth;
        double viewportImageHeight = viewportHeight * scale;
        double scrollY = positiveOrDefault(geometry.scrollY(), 0);
        double scrollOffset = scrollY > 0 && imageHeight > viewportImageHeight + 1 ? scrollY : 0;
        return Optional.of(clampMarker(x * scale, (y + scrollOffset) * scale, width * scale, height * scale, imageWidth, imageHeight));
    }

    private ReportPdfMarker clampMarker(double x, double y, double width, double height, int imageWidth, int imageHeight) {
        double clampedX = Math.max(0, Math.min(imageWidth - 1.0, x));
        double clampedY = Math.max(0, Math.min(imageHeight - 1.0, y));
        double clampedWidth = Math.max(1, Math.min(width, imageWidth - clampedX));
        double clampedHeight = Math.max(1, Math.min(height, imageHeight - clampedY));
        return new ReportPdfMarker(clampedX, clampedY, clampedWidth, clampedHeight);
    }

    private ReportPdfCrop crop(ReportPdfMarker marker, int imageWidth, int imageHeight) {
        double centerX = marker.x() + marker.width() / 2.0;
        double centerY = marker.y() + marker.height() / 2.0;
        int cropWidth = (int) Math.min(imageWidth, Math.max(620, Math.min(1100, marker.width() + 420)));
        int cropHeight = (int) Math.min(imageHeight, Math.max(420, Math.min(760, marker.height() + 340)));
        int x = (int) Math.round(centerX - cropWidth / 2.0);
        int y = (int) Math.round(centerY - cropHeight / 2.0);
        x = Math.max(0, Math.min(imageWidth - cropWidth, x));
        y = Math.max(0, Math.min(imageHeight - cropHeight, y));
        return new ReportPdfCrop(x, y, cropWidth, cropHeight);
    }

    private double positiveOrDefault(BigDecimal value, double defaultValue) {
        if (value == null || value.compareTo(BigDecimal.ZERO) <= 0) {
            return defaultValue;
        }
        return value.doubleValue();
    }

    private UUID parseUuid(String value) {
        try {
            return UUID.fromString(value.startsWith("artifact:") ? value.substring("artifact:".length()) : value);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("Invalid PDF screenshot artifact id: " + value, exception);
        }
    }

    private boolean startsWith(byte[] content, byte[] prefix) {
        if (content.length < prefix.length) {
            return false;
        }
        for (int index = 0; index < prefix.length; index++) {
            if (content[index] != prefix[index]) {
                return false;
            }
        }
        return true;
    }

    private static final class ImageBudget {
        private int imageCount;
        private long totalImageBytes;

        private void accept(int imageBytes) {
            imageCount++;
            totalImageBytes += imageBytes;
            if (imageCount > MAX_IMAGE_COUNT) {
                throw new IllegalStateException("PDF report includes too many screenshot images.");
            }
            if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
                throw new IllegalStateException("PDF report screenshot images exceed the configured payload budget.");
            }
        }
    }
}
