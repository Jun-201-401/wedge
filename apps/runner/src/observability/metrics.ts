import { createServer, type Server } from "node:http";
import { Counter, Histogram, register } from "prom-client";
import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";

const AI_REQUESTS_TOTAL_NAME = "wedge_ai_gms_requests_total";
const AI_REQUEST_DURATION_SECONDS_NAME = "wedge_ai_gms_request_duration_seconds";

type AiRequestStatus = "success" | "error";
export type AiRequestErrorType =
  | "none"
  | "timeout"
  | "http_error"
  | "invalid_json"
  | "network_error"
  | "unknown";

export interface AiRequestMetricsInput {
  service: string;
  feature: "agent_decision" | "scenario_authoring";
  model: string;
  status: AiRequestStatus;
  errorType: AiRequestErrorType;
  durationMs: number;
}

export interface RunnerMetricsServer {
  close: () => Promise<void>;
}

const aiRequestsTotal = new Counter({
  name: AI_REQUESTS_TOTAL_NAME,
  help: "Total number of Wedge AI GMS requests by service, feature, model, status, and error type.",
  labelNames: ["service", "feature", "model", "status", "error_type"] as const
});

const aiRequestDurationSeconds = new Histogram({
  name: AI_REQUEST_DURATION_SECONDS_NAME,
  help: "Duration of Wedge AI GMS requests in seconds by service, feature, model, status, and error type.",
  labelNames: ["service", "feature", "model", "status", "error_type"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30]
});

export function recordAiRequestMetrics(input: AiRequestMetricsInput): void {
  const labels = {
    service: input.service,
    feature: input.feature,
    model: normalizeMetricLabel(input.model, "unknown"),
    status: input.status,
    error_type: input.errorType
  };

  aiRequestsTotal.inc(labels);
  aiRequestDurationSeconds.observe(labels, Math.max(0, input.durationMs) / 1000);
}

export function startRunnerMetricsServer(config: RunnerConfig): RunnerMetricsServer | null {
  if (!config.metricsEnabled) {
    return null;
  }

  const server = createServer(async (request, response) => {
    if (request.url !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    try {
      response.writeHead(200, { "content-type": register.contentType });
      response.end(await register.metrics());
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`${errorMessage(error)}\n`);
    }
  });

  server.listen(config.metricsPort, config.metricsHost, () => {
    logOperationalEvent("runner-metrics", "server_started", {
      host: config.metricsHost,
      port: config.metricsPort,
      path: "/metrics"
    });
  });

  server.on("error", (error) => {
    logOperationalEvent("runner-metrics", "server_error", {
      reason: errorMessage(error)
    }, "error");
  });

  return {
    close: () => closeServer(server)
  };
}

function normalizeMetricLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
