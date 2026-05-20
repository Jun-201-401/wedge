import assert from "node:assert/strict";
import test from "node:test";
import { buildReportPdfHtml, renderReportPdf, type ReportPdfRenderPayload } from "../src/report-pdf/index.ts";
import { startReportPdfRendererServer } from "../src/report-pdf/server.ts";
import { createRunnerTestConfig } from "./support.ts";

test("buildReportPdfHtml creates a presentation report with screenshot overlay markup", () => {
  const html = buildReportPdfHtml(samplePayload());

  assert.match(html, /전환 흐름 리포트/);
  assert.match(html, /문제 컴포넌트 위치/);
  assert.match(html, /problem-marker/);
  assert.match(html, /button\.ad_mark/);
  assert.doesNotMatch(html, /Evidence ref/);
  assert.doesNotMatch(html, /Screenshot artifact/);
});

test("buildReportPdfHtml keeps small PDF text readable for presentation", () => {
  const html = buildReportPdfHtml(samplePayload());

  assert.match(html, /body\s*\{[\s\S]*?font-size: 12px/);
  assert.match(html, /\.eyebrow\s*\{[\s\S]*?font-size: 11px/);
  assert.match(html, /dt,[\s\S]*?\.location-panel h4\s*\{[\s\S]*?font-size: 11px/);
  assert.match(html, /\.reference-item small\s*\{[\s\S]*?font-size: 11px/);
  assert.match(html, /\.location-panel dd,[\s\S]*?\.meta-row dd\s*\{[\s\S]*?font-size: 12px/);
});

test("renderReportPdf returns PDF bytes", async () => {
  const pdf = await renderReportPdf(samplePayload());

  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 1000);
});

test("report PDF server authorizes requests and returns PDF bytes", async () => {
  const port = 19103;
  const server = startReportPdfRendererServer(createRunnerTestConfig({
    reportPdfRendererEnabled: true,
    reportPdfRendererHost: "127.0.0.1",
    reportPdfRendererPort: port,
    reportPdfRendererAuthToken: "test-token"
  }));
  assert.ok(server);

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await fetch(`http://127.0.0.1:${port}/internal/report-pdf/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer test-token"
      },
      body: JSON.stringify(samplePayload())
    });
    const pdf = Buffer.from(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  } finally {
    await server.close();
  }
});

function samplePayload(): ReportPdfRenderPayload {
  return {
    document: {
      reportId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      targetUrl: "https://example.com",
      goal: "첫 화면 CTA 흐름 점검",
      createdAt: "2026-05-19T01:00:00Z",
      totalSteps: 3,
      findingCount: 1,
      durationLabel: "42초",
      candidates: [
        {
          order: 1,
          title: "일부 클릭 대상이 작거나 가까이 배치되어 사용자가 정확히 누르기 어려울 수 있습니다.",
          stage: "다음 행동 선택",
          location: {
            label: "AD",
            selector: "button.ad_mark",
            role: "button",
            coordinateSpace: "viewport",
            bounds: "x=1327.0, y=440.0, width=31.0, height=20.0 (css_px)",
            viewport: "1440.0 x 900.0",
            scrollY: "0.0"
          },
          problemSummary: "일부 클릭 대상이 작거나 가까이 배치되어 사용자가 정확히 누르기 어려울 수 있습니다.",
          improvementDirection: "주요 버튼과 아이콘 버튼은 최소 24px 이상으로 확보하고 충분한 간격을 제공하기",
          judgementBasis: "작은 버튼이나 링크가 가까이 붙어 있으면 터치 환경에서 오입력이 늘어납니다.",
          expectedEffect: "오클릭 감소",
          difficulty: "낮음",
          validationQuestion: "사용자가 버튼을 헷갈리지 않고 누를 수 있나요?",
          references: [
            {
              publisher: "Chrome",
              title: "Tap targets are not sized appropriately",
              basisSummary: "클릭 대상이 작으면 사용자가 원하는 대상을 정확히 선택하기 어렵습니다.",
              url: "https://developer.chrome.com/docs/lighthouse/seo/tap-targets"
            }
          ]
        }
      ],
      flowGuides: [
        {
          label: "전환 흐름",
          description: "페이지 방문부터 목표 행동까지 이어지는 전체 과정입니다.",
          reference: {
            publisher: "Google Analytics",
            title: "Funnel exploration",
            basisSummary: "목표 행동까지 이어지는 단계를 나누어 봅니다.",
            url: "https://support.google.com/analytics/answer/9327974"
          }
        },
        {
          label: "첫 화면",
          description: "서비스가 무엇인지 바로 보이는지 봅니다.",
          reference: {
            publisher: "GOV.UK",
            title: "Start using a service",
            basisSummary: "서비스의 목적과 시작 지점이 바로 이해되는지 봅니다.",
            url: "https://design-system.service.gov.uk/patterns/start-using-a-service/"
          }
        }
      ]
    },
    candidateImages: [
      {
        candidateOrder: 1,
        image: {
          title: "문제 위치 스냅샷",
          mimeType: "image/png",
          dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAhUlEQVR4nO3QQQ3AIADAQMC/5yFjRxMFfXpn5qHTewB8Z5QwShiljFLCKGWUMkoZpYxSRimjlFHKKGWUMkoZpYxSRimjlFHKKGWUMkoZpYxSRimjlFHKKGWUMkoZpYxSRimjlFHKKGWUMkoZpYxSRimjlFHKKGWUMkoZpYxSRimjlFHKfAEXNgHJfFTDzgAAAABJRU5ErkJggg==",
          width: 100,
          height: 100,
          crop: {
            x: 0,
            y: 0,
            width: 100,
            height: 100
          },
          marker: {
            x: 55,
            y: 44,
            width: 18,
            height: 12
          }
        }
      }
    ]
  };
}
