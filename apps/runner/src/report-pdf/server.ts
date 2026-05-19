import { createServer, type Server } from "node:http";
import type { RunnerConfig } from "../config/index.ts";
import { errorMessage, logOperationalEvent } from "../shared/utils.ts";
import { renderReportPdf, validateReportPdfRenderPayload } from "./index.ts";

export interface ReportPdfRendererServer {
  close: () => Promise<void>;
}

export function startReportPdfRendererServer(config: RunnerConfig): ReportPdfRendererServer | null {
  if (!config.reportPdfRendererEnabled) {
    return null;
  }

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/internal/report-pdf/render") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    if (!isAuthorized(request.headers.authorization, config.reportPdfRendererAuthToken)) {
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end("unauthorized\n");
      return;
    }

    try {
      const payload = JSON.parse(await readRequestBody(request));
      validateReportPdfRenderPayload(payload);
      const pdf = await renderReportPdf(payload);
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(pdf);
    } catch (error) {
      response.writeHead(422, { "content-type": "text/plain; charset=utf-8" });
      response.end(`${errorMessage(error)}\n`);
    }
  });

  server.listen(config.reportPdfRendererPort, config.reportPdfRendererHost, () => {
    logOperationalEvent("runner-report-pdf", "server_started", {
      host: config.reportPdfRendererHost,
      port: config.reportPdfRendererPort,
      path: "/internal/report-pdf/render"
    });
  });

  server.on("error", (error) => {
    logOperationalEvent("runner-report-pdf", "server_error", {
      reason: errorMessage(error)
    }, "error");
  });

  return {
    close: () => closeServer(server)
  };
}

function isAuthorized(authorizationHeader: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken || expectedToken.trim().length === 0) {
    return true;
  }

  return authorizationHeader === `Bearer ${expectedToken}`;
}

async function readRequestBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
