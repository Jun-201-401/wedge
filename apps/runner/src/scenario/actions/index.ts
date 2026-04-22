import type { BrowserSession } from "../../browser/playwright/index.ts";
import type { ScenarioStep } from "../../shared/contracts.ts";

export const scenarioActions = [
  "goto",
  "click",
  "fill",
  "select",
  "scroll",
  "hover",
  "wait_for",
  "checkpoint",
  "stop_when"
];

export async function executeScenarioAction(session: BrowserSession, step: ScenarioStep) {
  return session.execute(step.action, step);
}
