import type { BrowserPageSnapshot, BrowserSession } from "../browser/playwright/index.ts";

export interface AgentObservation {
  snapshot: BrowserPageSnapshot;
}

export async function observePage(session: BrowserSession): Promise<AgentObservation> {
  return {
    snapshot: session.snapshot()
  };
}
