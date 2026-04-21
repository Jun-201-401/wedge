import { randomUUID } from "node:crypto";
import type { BrowserCapturedArtifacts, BrowserPageSnapshot, BrowserSettleResult } from "../browser/playwright/index.ts";
import type {
  ArtifactDraft,
  Checkpoint,
  ScenarioPlan,
  ScenarioStep
} from "../shared/contracts.ts";

export interface CheckpointCollection {
  checkpoint: Omit<Checkpoint, "artifactRefs">;
  artifacts: ArtifactDraft[];
}

export interface CapturePipeline {
  collectCheckpoint: (input: {
    step: ScenarioStep;
    stepOrder: number;
    plan: ScenarioPlan;
    pageSnapshot: BrowserPageSnapshot;
    settleResult: BrowserSettleResult;
    capturedArtifacts?: BrowserCapturedArtifacts;
  }) => Promise<CheckpointCollection>;
}

export function createCapturePipeline(): CapturePipeline {
  return {
    async collectCheckpoint({ step, stepOrder, plan, pageSnapshot, settleResult, capturedArtifacts }) {
      const screenshotArtifactId = randomUUID();
      const domArtifactId = randomUUID();
      const screenshotArtifact = createScreenshotArtifact({
        artifactId: screenshotArtifactId,
        pageSnapshot,
        stepOrder,
        goal: plan.goal,
        stepKey: step.step_id,
        capturedArtifacts
      });
      const domArtifact = createDomSnapshotArtifact({
        artifactId: domArtifactId,
        pageSnapshot,
        goal: plan.goal,
        stepKey: step.step_id,
        capturedArtifacts
      });
      const consoleLogArtifact =
        pageSnapshot.consoleErrors.length > 0
          ? {
              artifactId: randomUUID(),
              artifactType: "CONSOLE_LOG" as const,
              stepKey: step.step_id,
              mimeType: "application/json",
              fileExtension: "json",
              content: JSON.stringify(
                {
                  consoleErrors: pageSnapshot.consoleErrors
                },
                null,
                2
              )
            }
          : null;

      const observations = [
        ...Object.entries(pageSnapshot.fields).map(([fieldKey, value]) => ({
          type: "form_field",
          field_key: fieldKey,
          value_length: value.length
        })),
        ...(step.stage === "CTA" && step.action.type === "click"
          ? [
              {
                type: "cta_candidate",
                target: pageSnapshot.lastAction?.target
              }
            ]
          : []),
        ...pageSnapshot.consoleErrors.map((message) => ({
          type: "console_error",
          message
        })),
        ...pageSnapshot.networkErrors.map((message) => ({
          type: "network_failure",
          message
        })),
        ...createSettleObservations(settleResult)
      ];

      const deltas = pageSnapshot.lastAction
        ? [
            {
              type: "last_action",
              action: pageSnapshot.lastAction.type,
              target: pageSnapshot.lastAction.target
            }
          ]
        : [];

      const artifacts: ArtifactDraft[] = [
        screenshotArtifact,
        domArtifact
      ];

      if (consoleLogArtifact) {
        artifacts.push(consoleLogArtifact);
      }

      return {
        checkpoint: {
          checkpointId: randomUUID(),
          stepKey: step.step_id,
          stage: step.stage,
          trigger: {
            stepOrder,
            actionType: step.action.type,
            description: step.description
          },
          settle: {
            strategy: settleResult.strategy,
            durationMs: settleResult.durationMs,
            status: settleResult.status
          },
          state: {
            url: pageSnapshot.finalUrl,
            title: pageSnapshot.title,
            viewport: pageSnapshot.viewport,
            locale: pageSnapshot.locale,
            timezone: pageSnapshot.timezone,
            scrollY: pageSnapshot.scrollY,
            visitedUrls: pageSnapshot.visitedUrls,
            fields: pageSnapshot.fields,
            selectedOptions: pageSnapshot.selectedOptions,
            cdpSession: pageSnapshot.cdpSession
          },
          observations,
          deltas
        },
        artifacts
      };
    }
  };
}

function createSettleObservations(settleResult: BrowserSettleResult): Record<string, unknown>[] {
  if (!settleResult.details || typeof settleResult.details !== "object") {
    return [];
  }

  if (settleResult.strategy === "response") {
    return [
      {
        type: "settle_response",
        settle_status: settleResult.status,
        target: settleResult.targetSummary ?? null,
        matched_url: readStringDetail(settleResult.details, "matchedUrl"),
        method: readStringDetail(settleResult.details, "method"),
        status_code: readNumberDetail(settleResult.details, "status"),
        url_includes: readStringDetail(settleResult.details, "urlIncludes")
      }
    ];
  }

  if (settleResult.strategy === "item_count_change") {
    return [
      {
        type: "settle_item_count_change",
        settle_status: settleResult.status,
        target: settleResult.targetSummary ?? null,
        baseline_count: readNumberDetail(settleResult.details, "baselineCount"),
        current_count: readNumberDetail(settleResult.details, "currentCount"),
        expected_count: readNumberDetail(settleResult.details, "expectedCount"),
        min_count: readNumberDetail(settleResult.details, "minCount"),
        max_count: readNumberDetail(settleResult.details, "maxCount"),
        count_delta: readNumberDetail(settleResult.details, "countDelta")
      }
    ];
  }

  return [];
}

function readStringDetail(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === "string" ? value : null;
}

function readNumberDetail(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createScreenshotArtifact({
  artifactId,
  pageSnapshot,
  stepOrder,
  goal,
  stepKey,
  capturedArtifacts
}: {
  artifactId: string;
  pageSnapshot: BrowserPageSnapshot;
  stepOrder: number;
  goal: string;
  stepKey: string;
  capturedArtifacts?: BrowserCapturedArtifacts;
}): ArtifactDraft {
  if (capturedArtifacts?.screenshot) {
    return {
      artifactId,
      artifactType: "SCREENSHOT",
      stepKey,
      mimeType: capturedArtifacts.screenshot.mimeType,
      fileExtension: capturedArtifacts.screenshot.fileExtension,
      content: capturedArtifacts.screenshot.contentBase64,
      contentEncoding: "base64",
      width: capturedArtifacts.screenshot.width,
      height: capturedArtifacts.screenshot.height
    };
  }

  return {
    artifactId,
    artifactType: "SCREENSHOT",
    stepKey,
    mimeType: "image/svg+xml",
    fileExtension: "svg",
    content: createScreenshotSvg(pageSnapshot, stepOrder, goal),
    width: pageSnapshot.viewport.width,
    height: pageSnapshot.viewport.height
  };
}

function createDomSnapshotArtifact({
  artifactId,
  pageSnapshot,
  goal,
  stepKey,
  capturedArtifacts
}: {
  artifactId: string;
  pageSnapshot: BrowserPageSnapshot;
  goal: string;
  stepKey: string;
  capturedArtifacts?: BrowserCapturedArtifacts;
}): ArtifactDraft {
  if (capturedArtifacts?.domSnapshot) {
    return {
      artifactId,
      artifactType: "DOM_SNAPSHOT",
      stepKey,
      mimeType: capturedArtifacts.domSnapshot.mimeType,
      fileExtension: capturedArtifacts.domSnapshot.fileExtension,
      content: capturedArtifacts.domSnapshot.content
    };
  }

  return {
    artifactId,
    artifactType: "DOM_SNAPSHOT",
    stepKey,
    mimeType: "text/html",
    fileExtension: "html",
    content: createHtmlSnapshot(pageSnapshot, goal)
  };
}

function createScreenshotSvg(pageSnapshot: BrowserPageSnapshot, stepOrder: number, goal: string): string {
  const lines = [
    `Step ${stepOrder}`,
    pageSnapshot.title,
    pageSnapshot.finalUrl,
    goal
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageSnapshot.viewport.width}" height="${pageSnapshot.viewport.height}">`,
    `<rect width="100%" height="100%" fill="#f4f1ea" />`,
    `<rect x="32" y="32" width="${pageSnapshot.viewport.width - 64}" height="120" rx="16" fill="#16324f" />`,
    ...lines.map(
      (line, index) =>
        `<text x="56" y="${80 + index * 28}" fill="#fffdf6" font-size="20" font-family="monospace">${escapeHtml(
          line
        )}</text>`
    ),
    `</svg>`
  ].join("");
}

function createHtmlSnapshot(pageSnapshot: BrowserPageSnapshot, goal: string): string {
  const fieldMarkup = Object.entries(pageSnapshot.fields)
    .map(([fieldKey, value]) => `<li><strong>${escapeHtml(fieldKey)}</strong>: ${escapeHtml(value)}</li>`)
    .join("");

  return [
    "<!doctype html>",
    "<html lang=\"ko\">",
    "<head><meta charset=\"utf-8\" /><title>Wedge Runner Snapshot</title></head>",
    "<body>",
    `<h1>${escapeHtml(pageSnapshot.title)}</h1>`,
    `<p data-goal>${escapeHtml(goal)}</p>`,
    `<p data-url>${escapeHtml(pageSnapshot.finalUrl)}</p>`,
    `<ul>${fieldMarkup}</ul>`,
    "</body>",
    "</html>"
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
