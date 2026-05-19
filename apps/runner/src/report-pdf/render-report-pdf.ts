import { renderReportPdf, type ReportPdfRenderPayload } from "./index.ts";

try {
  const payload = JSON.parse(await readStdin()) as ReportPdfRenderPayload;
  const pdf = await renderReportPdf(payload);
  process.stdout.write(pdf);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
