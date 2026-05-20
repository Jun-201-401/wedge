import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

export interface ReportPdfRenderPayload {
  document: ReportDownloadDocument;
  candidateImages: ReportPdfCandidateImage[];
}

export interface ReportDownloadDocument {
  reportId: string;
  runId: string;
  targetUrl: string;
  goal: string;
  createdAt: string;
  totalSteps: number;
  findingCount: number;
  durationLabel: string;
  candidates: ReportDownloadCandidate[];
  flowGuides: ReportDownloadFlowGuide[];
}

export interface ReportDownloadCandidate {
  order: number;
  title: string;
  stage: string;
  location?: ReportDownloadProblemLocation | null;
  problemSummary: string;
  improvementDirection: string;
  judgementBasis: string;
  expectedEffect?: string | null;
  difficulty?: string | null;
  validationQuestion?: string | null;
  references: ReportDownloadReference[];
}

export interface ReportDownloadProblemLocation {
  label?: string | null;
  selector?: string | null;
  role?: string | null;
  coordinateSpace?: string | null;
  bounds?: string | null;
  viewport?: string | null;
  scrollY?: string | null;
}

export interface ReportDownloadReference {
  publisher: string;
  title: string;
  basisSummary: string;
  url: string;
}

export interface ReportDownloadFlowGuide {
  label: string;
  description: string;
  reference: ReportDownloadReference;
}

export interface ReportPdfCandidateImage {
  candidateOrder: number;
  image: ReportPdfProblemImage;
}

export interface ReportPdfProblemImage {
  title: string;
  mimeType: string;
  dataUri: string;
  width: number;
  height: number;
  crop: ReportPdfCrop;
  marker: ReportPdfMarker;
}

export interface ReportPdfCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReportPdfMarker {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function renderReportPdf(payload: ReportPdfRenderPayload): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1240,
        height: 1754
      },
      deviceScaleFactor: 1
    });
    await page.emulateMedia({ media: "print" });
    await page.setContent(buildReportPdfHtml(payload), { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0"
      }
    });
  } finally {
    await browser.close();
  }
}

export function validateReportPdfRenderPayload(value: unknown): asserts value is ReportPdfRenderPayload {
  assertRecord(value, "payload");
  assertRecord(value.document, "payload.document");
  assertArray(value.document.candidates, "payload.document.candidates");
  assertArray(value.document.flowGuides, "payload.document.flowGuides");
  assertString(value.document.targetUrl, "payload.document.targetUrl");
  assertString(value.document.goal, "payload.document.goal");
  assertArray(value.candidateImages, "payload.candidateImages");

  for (const [index, candidateImage] of value.candidateImages.entries()) {
    assertRecord(candidateImage, `payload.candidateImages[${index}]`);
    assertPositiveNumber(candidateImage.candidateOrder, `payload.candidateImages[${index}].candidateOrder`);
    assertRecord(candidateImage.image, `payload.candidateImages[${index}].image`);
    assertString(candidateImage.image.dataUri, `payload.candidateImages[${index}].image.dataUri`);
    assertRecord(candidateImage.image.crop, `payload.candidateImages[${index}].image.crop`);
    assertRecord(candidateImage.image.marker, `payload.candidateImages[${index}].image.marker`);
    assertPositiveNumber(candidateImage.image.crop.width, `payload.candidateImages[${index}].image.crop.width`);
    assertPositiveNumber(candidateImage.image.crop.height, `payload.candidateImages[${index}].image.crop.height`);
    assertPositiveNumber(candidateImage.image.marker.width, `payload.candidateImages[${index}].image.marker.width`);
    assertPositiveNumber(candidateImage.image.marker.height, `payload.candidateImages[${index}].image.marker.height`);
  }
}

export function buildReportPdfHtml(payload: ReportPdfRenderPayload): string {
  const document = payload.document;
  const imagesByCandidateOrder = new Map(payload.candidateImages.map((candidateImage) => [candidateImage.candidateOrder, candidateImage.image]));
  const candidateCount = document.candidates.length;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>전환 흐름 리포트</title>
  <style>${reportCss()}</style>
</head>
<body>
  <main class="report">
    <section class="cover">
      <p class="eyebrow">Wedge Conversion Report</p>
      <h1>전환 흐름 리포트</h1>
      <p class="lede">${escapeHtml(document.goal)}</p>
      <dl class="summary-grid">
        ${summaryItem("분석 대상", document.targetUrl)}
        ${summaryItem("개선 후보", `${candidateCount}개`)}
        ${summaryItem("마찰 지점", `${document.findingCount}개`)}
        ${summaryItem("분석 시간", document.durationLabel)}
      </dl>
    </section>
    <section class="section">
      <div class="section-heading">
        <p class="eyebrow">Priority Fixes</p>
        <h2>개선 후보</h2>
      </div>
      ${document.candidates.length === 0 ? emptyState() : document.candidates.map((candidate) => candidateHtml(candidate, imagesByCandidateOrder.get(candidate.order))).join("")}
    </section>
    <section class="section">
      <div class="section-heading">
        <p class="eyebrow">Decision Basis</p>
        <h2>단계별 판단 기준</h2>
      </div>
      <div class="guide-grid">
        ${document.flowGuides.filter((guide) => guide.label !== "전환 흐름").map(flowGuideHtml).join("")}
      </div>
    </section>
    <section class="section">
      <div class="section-heading">
        <p class="eyebrow">References</p>
        <h2>기준 근거</h2>
      </div>
      <div class="reference-list">
        ${document.flowGuides.map((guide) => referenceHtml(guide.label, guide.reference)).join("")}
      </div>
    </section>
  </main>
</body>
</html>`;
}

function candidateHtml(candidate: ReportDownloadCandidate, image?: ReportPdfProblemImage): string {
  return `<article class="candidate">
    <header class="candidate-header">
      <div>
        <p class="candidate-number">Nudge ${String(candidate.order).padStart(2, "0")}</p>
        <h3>${escapeHtml(candidate.title)}</h3>
      </div>
    </header>
    ${image ? problemImageHtml(image) : ""}
    ${candidate.location ? locationHtml(candidate.location) : ""}
    <div class="insight-grid">
      ${insightCard("문제 요약", candidate.problemSummary)}
      ${insightCard("개선 방향", candidate.improvementDirection)}
      ${insightCard("판단 근거", candidate.judgementBasis)}
    </div>
    ${optionalMeta(candidate)}
    ${candidate.references.length > 0 ? `<div class="reference-list compact">${candidate.references.map((reference) => referenceHtml(reference.publisher, reference)).join("")}</div>` : ""}
  </article>`;
}

function problemImageHtml(image: ReportPdfProblemImage): string {
  const crop = image.crop;
  const marker = image.marker;
  const imageWidthPercent = (image.width / crop.width) * 100;
  const imageHeightPercent = (image.height / crop.height) * 100;
  const imageLeftPercent = (-crop.x / crop.width) * 100;
  const imageTopPercent = (-crop.y / crop.height) * 100;
  const markerLeftPercent = ((marker.x - crop.x) / crop.width) * 100;
  const markerTopPercent = ((marker.y - crop.y) / crop.height) * 100;
  const markerWidthPercent = (marker.width / crop.width) * 100;
  const markerHeightPercent = (marker.height / crop.height) * 100;

  return `<figure class="problem-shot">
    <figcaption>${escapeHtml(image.title)}</figcaption>
    <div class="problem-shot__frame" style="aspect-ratio: ${crop.width} / ${crop.height};">
      <img
        src="${escapeAttribute(image.dataUri)}"
        alt=""
        style="width: ${imageWidthPercent}%; height: ${imageHeightPercent}%; left: ${imageLeftPercent}%; top: ${imageTopPercent}%;"
      >
      <span
        class="problem-marker"
        aria-hidden="true"
        style="left: ${markerLeftPercent}%; top: ${markerTopPercent}%; width: ${markerWidthPercent}%; height: ${markerHeightPercent}%;"
      ></span>
    </div>
  </figure>`;
}

function locationHtml(location: ReportDownloadProblemLocation): string {
  const items = [
    ["레이블", location.label],
    ["CSS selector", location.selector],
    ["역할", location.role],
    ["좌표", location.bounds],
    ["Viewport", location.viewport],
    ["Scroll Y", location.scrollY],
    ["좌표 기준", location.coordinateSpace]
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");

  if (items.length === 0) {
    return "";
  }

  return `<section class="location-panel">
    <h4>문제 컴포넌트 위치</h4>
    <dl>
      ${items.map(([label, value]) => `<div><dt>${escapeHtml(label ?? "")}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}
    </dl>
  </section>`;
}

function optionalMeta(candidate: ReportDownloadCandidate): string {
  const values = [
    ["기대 효과", candidate.expectedEffect],
    ["난이도", candidate.difficulty],
    ["검증 질문", candidate.validationQuestion]
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");

  if (values.length === 0) {
    return "";
  }

  return `<dl class="meta-row">
    ${values.map(([label, value]) => `<div><dt>${escapeHtml(label ?? "")}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}
  </dl>`;
}

function insightCard(label: string, value: string): string {
  return `<section class="insight-card">
    <h4>${escapeHtml(label)}</h4>
    <p>${escapeHtml(value)}</p>
  </section>`;
}

function flowGuideHtml(guide: ReportDownloadFlowGuide): string {
  return `<article class="guide-card">
    <h3>${escapeHtml(guide.label)}</h3>
    <p>${escapeHtml(guide.description)}</p>
  </article>`;
}

function referenceHtml(label: string, reference: ReportDownloadReference): string {
  return `<article class="reference-item">
    <p class="reference-label">${escapeHtml(label)}</p>
    <h3>${escapeHtml(reference.publisher)} / ${escapeHtml(reference.title)}</h3>
    <p>${escapeHtml(reference.basisSummary)}</p>
    <small>${escapeHtml(reference.url)}</small>
  </article>`;
}

function summaryItem(label: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function emptyState(): string {
  return `<div class="empty-state">현재 우선 수정할 항목은 없습니다.</div>`;
}

function reportCss(): string {
  return `
${koreanFontFaceCss()}

@page {
  size: A4;
  margin: 10mm;
}

* {
  box-sizing: border-box;
}

html {
  color: #0f172a;
  font-family: "Wedge Korean", "Noto Sans CJK KR", "Noto Sans KR", "NanumGothic", "Malgun Gothic", Arial, sans-serif;
}

body {
  margin: 0;
  background: #ffffff;
  font-size: 12px;
  line-height: 1.55;
}

.report {
  width: 100%;
}

.cover {
  break-inside: avoid;
  margin-bottom: 14px;
  padding: 18px;
  border-radius: 16px;
  background: #eef6ff;
}

.eyebrow {
  margin: 0 0 7px;
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}

h1,
h2,
h3,
h4,
p,
dl {
  margin: 0;
}

h1 {
  font-size: 28px;
  line-height: 1.18;
}

.lede {
  margin-top: 7px;
  color: #334155;
  font-size: 14px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.summary-grid div,
.guide-card,
.insight-card,
.reference-item,
.location-panel,
.empty-state {
  border-radius: 12px;
  background: #ffffff;
}

.summary-grid div {
  padding: 12px 14px;
}

dt,
.reference-label,
.candidate-number,
.problem-shot figcaption,
.insight-card h4,
.location-panel h4 {
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
}

dd {
  margin: 4px 0 0;
  color: #0f172a;
  font-weight: 700;
}

.section {
  margin-top: 14px;
}

.section-heading {
  margin-bottom: 8px;
}

.section-heading h2 {
  font-size: 19px;
}

.candidate {
  break-inside: auto;
  page-break-inside: auto;
  margin-top: 10px;
  padding: 14px;
  border-radius: 16px;
  background: #f8fafc;
}

.candidate-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}

.candidate-header h3 {
  margin-top: 3px;
  font-size: 18px;
  line-height: 1.3;
}

.problem-shot {
  break-inside: avoid;
  margin: 0 0 10px;
}

.problem-shot figcaption {
  margin-bottom: 5px;
}

.problem-shot__frame {
  position: relative;
  overflow: hidden;
  width: 100%;
  max-height: 320px;
  border-radius: 12px;
  background: #e2e8f0;
}

.problem-shot__frame img {
  position: absolute;
  max-width: none;
  object-fit: fill;
}

.problem-marker {
  position: absolute;
  transform: translate(-32%, -40%);
  min-width: 72px;
  min-height: 52px;
  border: 8px solid rgba(239, 68, 68, .88);
  border-radius: 999px;
  background: rgba(239, 68, 68, .18);
}

.location-panel {
  break-inside: avoid;
  margin-bottom: 10px;
  padding: 10px;
}

.location-panel dl,
.meta-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin-top: 7px;
}

.location-panel dd,
.meta-row dd {
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 600;
}

.insight-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
}

.insight-card {
  break-inside: avoid;
  padding: 10px;
}

.insight-card p {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 700;
}

.meta-row {
  break-inside: avoid;
  margin-top: 8px;
  padding: 10px;
  border-radius: 12px;
  background: #ffffff;
}

.reference-list {
  display: grid;
  gap: 7px;
}

.reference-list.compact {
  margin-top: 8px;
}

.reference-item {
  break-inside: avoid;
  padding: 10px;
}

.reference-item h3 {
  margin-top: 4px;
  font-size: 14px;
}

.reference-item p:not(.reference-label) {
  margin-top: 5px;
  color: #334155;
  font-size: 12px;
}

.reference-item small {
  display: block;
  margin-top: 5px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.guide-card {
  padding: 14px;
  background: #f8fafc;
}

.guide-card h3 {
  font-size: 14px;
}

.guide-card p {
  margin-top: 6px;
  color: #334155;
  font-size: 12px;
}

.empty-state {
  padding: 18px;
  color: #64748b;
}
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function koreanFontFaceCss(): string {
  const fontPath = [
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf",
    "/mnt/c/Windows/Fonts/malgun.ttf",
    "C:/Windows/Fonts/malgun.ttf"
  ].find((candidate) => existsSync(candidate));

  if (!fontPath) {
    return "";
  }

  const fontBase64 = readFileSync(fontPath).toString("base64");
  return `@font-face {
  font-family: "Wedge Korean";
  src: url("data:font/truetype;base64,${fontBase64}") format("truetype");
  font-weight: 400 900;
  font-style: normal;
}`;
}

function assertRecord(value: unknown, fieldName: string): asserts value is Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
}

function assertArray(value: unknown, fieldName: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
}

function assertString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
}

function assertPositiveNumber(value: unknown, fieldName: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
}
