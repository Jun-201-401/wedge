import { RunnerMessageValidationError } from "./validators/common.ts";

export function parseJsonMessage(rawMessage: string, label: string): unknown {
  try {
    return JSON.parse(rawMessage) as unknown;
  } catch {
    throw new RunnerMessageValidationError(`${label} message must be valid JSON`);
  }
}
