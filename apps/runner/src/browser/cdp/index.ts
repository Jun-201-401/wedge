import { toIsoTimestamp } from "../../shared/utils.ts";

export interface CdpSessionMetadata {
  protocol: "cdp";
  transport: "simulated";
  userAgent: string;
  tracingEnabled: boolean;
  createdAt: string;
}

export function createCdpSession(): CdpSessionMetadata {
  return {
    protocol: "cdp",
    transport: "simulated",
    userAgent: "wedge-runner-scaffold",
    tracingEnabled: false,
    createdAt: toIsoTimestamp()
  };
}
