import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserSessionFactory } from "../src/browser/playwright/index.ts";
import type { CallbackClient } from "../src/callback/index.ts";
import type { CapturePipeline } from "../src/capture/index.ts";
import type { RunnerConfig } from "../src/config/index.ts";
import type { ArtifactStore } from "../src/storage/index.ts";
import { registerAgentWorker, type AgentRunnerWorker } from "../src/worker/agent-worker.ts";
import type { InteractiveComponentObservationItem } from "../src/shared/contracts.ts";
import { createRunnerTestConfig, createStubCallbackClient } from "./support.ts";

export function createAgentWorkerHarness(input: {
  name: string;
  browserFactory: BrowserSessionFactory;
  callbackClient?: CallbackClient;
  capturePipeline?: CapturePipeline;
  artifactStore?: ArtifactStore;
  configOverrides?: Partial<RunnerConfig>;
}): AgentRunnerWorker {
  return registerAgentWorker({
    config: createRunnerTestConfig({
      artifactsRoot: join(tmpdir(), `runner-test-agent-${input.name}-artifacts`),
      callbackLogFile: join(tmpdir(), `runner-test-agent-${input.name}-callbacks.jsonl`),
      ...input.configOverrides
    }),
    browserFactory: input.browserFactory,
    callbackClient: input.callbackClient ?? createStubCallbackClient(),
    capturePipeline: input.capturePipeline ?? {
      collectCheckpoint: async () => {
        throw new Error("agent harness checkpoint collection should be overridden when expected");
      }
    },
    artifactStore: input.artifactStore ?? {
      persistArtifacts: async () => []
    }
  });
}

export function createCheckoutHeuristicComponents(
  currentUrl: string,
  loaded: boolean,
  addedToCart: boolean
): InteractiveComponentObservationItem[] {
  if (!loaded) {
    return [];
  }

  if (currentUrl.endsWith("/cart")) {
    return [
      createAgentComponent("Checkout", "#checkout", true),
      createAgentComponent("Remove item", "#remove", false)
    ];
  }

  if (addedToCart) {
    return [
      createAgentComponent("장바구니", "#cart", false),
      createAgentComponent("계속 쇼핑", "#continue", true)
    ];
  }

  return [
    createAgentComponent("Learn more", "#learn-more", true),
    createAgentComponent("장바구니 담기", "#add-to-cart", false)
  ];
}

export function createAgentComponent(
  text: string,
  selector: string,
  isPrimaryLike: boolean
): InteractiveComponentObservationItem {
  return {
    text,
    selector,
    role: "button",
    tag: "button",
    clickable: true,
    clicked_in_scenario: false,
    is_cta_candidate: true,
    is_primary_like: isPrimaryLike,
    bounds: {
      x: 10,
      y: 10,
      width: 120,
      height: 40,
      unit: "css_px"
    }
  };
}
