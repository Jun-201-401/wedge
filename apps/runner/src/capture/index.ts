import { randomUUID } from "node:crypto";
import type { BrowserPageSnapshot, BrowserSettleResult } from "../browser/playwright/index.ts";
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
  }) => Promise<CheckpointCollection>;
}

export function createCapturePipeline(): CapturePipeline {
  return {
    async collectCheckpoint({ step, stepOrder, plan, pageSnapshot, settleResult }) {
      const screenshotArtifactId = randomUUID();
      const domArtifactId = randomUUID();
      const screenshotSvg = createScreenshotSvg(pageSnapshot, stepOrder, plan.goal);
      const htmlSnapshot = createHtmlSnapshot(pageSnapshot, plan.goal);
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
        }))
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
        {
          artifactId: screenshotArtifactId,
          artifactType: "SCREENSHOT",
          stepKey: step.step_id,
          mimeType: "image/svg+xml",
          fileExtension: "svg",
          content: screenshotSvg,
          width: pageSnapshot.viewport.width,
          height: pageSnapshot.viewport.height
        },
        {
          artifactId: domArtifactId,
          artifactType: "DOM_SNAPSHOT",
          stepKey: step.step_id,
          mimeType: "text/html",
          fileExtension: "html",
          content: htmlSnapshot
        }
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
