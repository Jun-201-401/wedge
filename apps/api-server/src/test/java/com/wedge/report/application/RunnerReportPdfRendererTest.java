package com.wedge.report.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.wedge.evidence.application.EvidenceService;
import com.wedge.report.api.dto.DecisionMapItemResponse;
import com.wedge.report.api.dto.ReportDetailFindingResponse;
import com.wedge.report.api.dto.ReportDetailNudgeResponse;
import com.wedge.report.api.dto.ReportDetailResponse;
import com.wedge.report.api.dto.ReportFindingHighlightResponse;
import com.wedge.report.domain.ReportFormat;
import com.wedge.run.api.dto.RunResponse;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ReportStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class RunnerReportPdfRendererTest {
    @Mock
    private EvidenceService evidenceService;

    @Test
    void renderPostsPayloadToRunnerRendererAndReturnsPdfBytes() throws IOException {
        UUID runId = UUID.randomUUID();
        UUID screenshotArtifactId = UUID.randomUUID();
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = pdfServer(requestBody);
        server.start();
        try {
            RunnerReportPdfRenderer renderer = new RunnerReportPdfRenderer(
                    new ReportDownloadDocumentBuilder(),
                    evidenceService,
                    new ObjectMapper()
            );
            ReflectionTestUtils.setField(renderer, "rendererBaseUrl", "http://127.0.0.1:" + server.getAddress().getPort());
            ReflectionTestUtils.setField(renderer, "timeoutMs", 30000L);
            ReflectionTestUtils.setField(renderer, "authToken", "test-token");
            when(evidenceService.getRunImageArtifactContent(runId, screenshotArtifactId))
                    .thenReturn(new EvidenceService.ArtifactContent(new ByteArrayResource(samplePng()), "image/png", "screenshot.png"));

            byte[] pdf = renderer.render(detail(runId, screenshotArtifactId), run(runId));

            assertThat(new String(pdf, 0, Math.min(pdf.length, 5), StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
            assertThat(pdf.length).isGreaterThan(8);
            assertThat(requestBody.get()).contains("\"candidateImages\"", "\"dataUri\"", "\"marker\"", "\"crop\"");
        } finally {
            server.stop(0);
        }
    }

    private HttpServer pdfServer(AtomicReference<String> requestBody) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/report-pdf/render", exchange -> {
            if (!"Bearer test-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
                exchange.sendResponseHeaders(401, -1);
                return;
            }
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] pdf = "%PDF-TEST\n".getBytes(StandardCharsets.US_ASCII);
            exchange.getResponseHeaders().set("Content-Type", "application/pdf");
            exchange.sendResponseHeaders(200, pdf.length);
            exchange.getResponseBody().write(pdf);
            exchange.close();
        });
        return server;
    }

    private ReportDetailResponse detail(UUID runId, UUID screenshotArtifactId) {
        ReportDetailNudgeResponse nudge = new ReportDetailNudgeResponse(
                UUID.randomUUID(),
                1,
                "CTA 카피 수정",
                "사용자가 다음 행동의 가치를 바로 판단하기 어렵습니다.",
                "버튼 문구를 구체화하세요",
                "낮음",
                "클릭 전환율 개선",
                "사용자가 첫 화면에서 다음 행동을 설명할 수 있나요?"
        );
        ReportFindingHighlightResponse highlight = new ReportFindingHighlightResponse(
                "checkpoint-1.component_001",
                "Start free",
                "artifact-coordinate",
                "viewport",
                new ReportFindingHighlightResponse.Bounds(
                        BigDecimal.valueOf(180),
                        BigDecimal.valueOf(150),
                        BigDecimal.valueOf(120),
                        BigDecimal.valueOf(48),
                        "css_px"
                ),
                new ReportFindingHighlightResponse.Viewport(BigDecimal.valueOf(640), BigDecimal.valueOf(480)),
                BigDecimal.ZERO,
                screenshotArtifactId.toString()
        );
        ReportDetailFindingResponse finding = new ReportDetailFindingResponse(
                UUID.randomUUID(),
                1,
                "CTA 문구가 모호합니다",
                "첫 화면에서 핵심 CTA가 충분히 구체적이지 않습니다.",
                "copy",
                "첫 화면",
                "clarity",
                4,
                BigDecimal.valueOf(0.91),
                BigDecimal.valueOf(0.82),
                "사용자가 CTA 클릭 전에 기대 결과를 이해하지 못할 수 있습니다.",
                List.of(),
                List.of(),
                null,
                highlight,
                List.of(nudge)
        );
        return new ReportDetailResponse(
                UUID.randomUUID(),
                runId,
                UUID.randomUUID(),
                "전환 마찰 리포트",
                ReportFormat.JSON,
                ReportStatus.READY,
                BigDecimal.valueOf(72),
                Map.of("핵심 요약", "CTA 명확성 개선 필요"),
                List.of(new DecisionMapItemResponse("첫 화면", "CTA 발견", "FRICTION", List.of("F-1"), "사용자가 버튼 가치를 판단해야 합니다.", List.of("artifact:1"))),
                3,
                List.of(finding),
                OffsetDateTime.parse("2026-05-19T01:00:00Z")
        );
    }

    private RunResponse run(UUID runId) {
        return new RunResponse(
                runId,
                "run",
                UUID.randomUUID(),
                "Landing CTA audit",
                "WEB",
                URI.create("https://example.com"),
                "첫 화면 CTA 흐름 점검",
                "desktop",
                UUID.randomUUID(),
                RunStatus.COMPLETED,
                ResultCompleteness.FINAL,
                AnalysisStatus.COMPLETED,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }

    private byte[] samplePng() {
        try {
            BufferedImage image = new BufferedImage(640, 480, BufferedImage.TYPE_INT_RGB);
            java.awt.Graphics2D graphics = image.createGraphics();
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
            graphics.setColor(new Color(226, 232, 240));
            graphics.fillRect(120, 96, 400, 260);
            graphics.setColor(new Color(37, 99, 235));
            graphics.fillRoundRect(180, 150, 120, 48, 14, 14);
            graphics.dispose();
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                ImageIO.write(image, "png", output);
                return output.toByteArray();
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to create sample PNG.", exception);
        }
    }
}
