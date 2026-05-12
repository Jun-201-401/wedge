import { readFile } from "node:fs/promises";
import type {
  AgentExecuteMessage,
  DiscoveryExecuteMessage,
  RunExecuteMessage,
  ScenarioAuthoringExecuteMessage
} from "../shared/contracts.ts";
import { parseJsonMessage } from "./parse-json.ts";
import { assertAgentExecuteMessage } from "./validators/agent.ts";
import { assertScenarioAuthoringExecuteMessage } from "./validators/authoring.ts";
import { RunnerMessageValidationError } from "./validators/common.ts";
import { assertDiscoveryExecuteMessage } from "./validators/discovery.ts";
import { assertRunExecuteMessage } from "./validators/run.ts";

export { RunnerMessageValidationError };

export async function readRunExecuteMessage(messageFile: string): Promise<RunExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseRunExecuteMessage(rawMessage);
}

export async function readAgentExecuteMessage(messageFile: string): Promise<AgentExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseAgentExecuteMessage(rawMessage);
}

export async function readDiscoveryExecuteMessage(messageFile: string): Promise<DiscoveryExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseDiscoveryExecuteMessage(rawMessage);
}

export async function readScenarioAuthoringExecuteMessage(messageFile: string): Promise<ScenarioAuthoringExecuteMessage> {
  const rawMessage = await readFile(messageFile, "utf8");
  return parseScenarioAuthoringExecuteMessage(rawMessage);
}

export function parseRunExecuteMessage(rawMessage: string): RunExecuteMessage {
  const parsed = parseJsonMessage(rawMessage, "runner");
  assertRunExecuteMessage(parsed);
  return parsed;
}

export function parseAgentExecuteMessage(rawMessage: string): AgentExecuteMessage {
  const parsed = parseJsonMessage(rawMessage, "agent");
  assertAgentExecuteMessage(parsed);
  return parsed;
}

export function parseDiscoveryExecuteMessage(rawMessage: string): DiscoveryExecuteMessage {
  const parsed = parseJsonMessage(rawMessage, "discovery");
  assertDiscoveryExecuteMessage(parsed);
  return parsed;
}

export function parseScenarioAuthoringExecuteMessage(rawMessage: string): ScenarioAuthoringExecuteMessage {
  const parsed = parseJsonMessage(rawMessage, "scenario authoring");
  assertScenarioAuthoringExecuteMessage(parsed);
  return parsed;
}
