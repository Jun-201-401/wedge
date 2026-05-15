import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { parseAgentExecuteMessage } from "../src/messaging/index.ts";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");

test("[계약 동기화] runner TS mirror의 scenario/MQ literal이 packages/contracts와 어긋나지 않는다", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const scenarioSchema = await readJson(resolve(repoRoot, "packages/contracts/schemas/scenario-plan.schema.json"));
  const mqSchema = await readJson(resolve(repoRoot, "packages/contracts/mq/messages.schema.json"));

  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "ScenarioActionType",
    scenarioSchema,
    scenarioSchema.$defs.action.properties.type
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "SettleStrategyType",
    scenarioSchema,
    scenarioSchema.$defs.settle_strategy.properties.type
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "ScenarioStage",
    scenarioSchema,
    scenarioSchema.$defs.stage ?? scenarioSchema.$defs.DecisionStage
  );

  assertPropertyMatchesSchemaEnum(runnerTypesSource, "scenario_type", scenarioSchema, scenarioSchema.properties.scenario_type);
  assertPropertyMatchesSchemaEnum(runnerTypesSource, "device", scenarioSchema, scenarioSchema.properties.environment.properties.device);
  assertPropertyMatchesSchemaEnum(
    runnerTypesSource,
    "auth_state",
    scenarioSchema,
    scenarioSchema.properties.environment.properties.auth_state
  );
  assertPropertyMatchesSchemaEnum(runnerTypesSource, "triggerSource", mqSchema, mqSchema.$defs.RunExecutePayload.properties.triggerSource);
  assertPropertyMatchesSchemaEnum(runnerTypesSource, "devicePreset", mqSchema, mqSchema.$defs.RunExecutePayload.properties.devicePreset);
  assertTypeAliasMatchesSchemaEnum(runnerTypesSource, "AgentGoalType", mqSchema, mqSchema.$defs.AgentTask.properties.goal_type);
  assert.ok(runnerTypesSource.includes('messageType: "run.execute.request";'));
  assert.equal(mqSchema.$defs.RunExecuteMessage.properties.messageType.const, "run.execute.request");
  assert.ok(runnerTypesSource.includes('messageType: "agent.execute.request";'));
  assert.equal(mqSchema.$defs.AgentExecuteMessage.properties.messageType.const, "agent.execute.request");

  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "url_includes", scenarioSchema.$defs.settle_strategy.properties.url_includes);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "method", scenarioSchema.$defs.settle_strategy.properties.method);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "status", scenarioSchema.$defs.settle_strategy.properties.status);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "expected_count", scenarioSchema.$defs.settle_strategy.properties.expected_count);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "min_count", scenarioSchema.$defs.settle_strategy.properties.min_count);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "max_count", scenarioSchema.$defs.settle_strategy.properties.max_count);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "count_delta", scenarioSchema.$defs.settle_strategy.properties.count_delta);
});

test("[계약 동기화] ScenarioAuthoring TS mirror가 packages/contracts authoring schema와 어긋나지 않는다", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const authoringSchema = await readJson(resolve(repoRoot, "packages/contracts/schemas/scenario-authoring.schema.json"));

  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "ScenarioAuthoringStatus",
    authoringSchema,
    authoringSchema.$defs.authoring_status
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "ScenarioAuthoringProviderType",
    authoringSchema,
    authoringSchema.$defs.provider_type
  );
});


test("[계약 동기화] agent.execute 공식 contract entrypoint와 예제가 유지된다", async () => {
  const agentSchemaFiles = [
    "schemas/agent-task.schema.json",
    "schemas/agent-observation.schema.json",
    "schemas/agent-decision.schema.json",
    "schemas/agent-policy-result.schema.json",
    "schemas/agent-verification-result.schema.json",
    "schemas/agent-event.schema.json",
    "schemas/agent-outcome.schema.json",
    "schemas/agent-trace.schema.json",
    "mq/agent.execute.request.schema.json"
  ];

  for (const relativePath of agentSchemaFiles) {
    const schema = await readJson(resolve(repoRoot, "packages/contracts", relativePath));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.ok(schema.$id.endsWith(relativePath));
  }

  const agentMqEntrypoint = await readJson(resolve(repoRoot, "packages/contracts/mq/agent.execute.request.schema.json"));
  assert.equal(agentMqEntrypoint.$ref, "./messages.schema.json#/$defs/AgentExecutePayload");

  const agentRequestRaw = await readFile(
    resolve(repoRoot, "packages/contracts/examples/sample-agent-execute-checkout-entry.request.json"),
    "utf8"
  );
  const parsedAgentRequest = parseAgentExecuteMessage(agentRequestRaw);
  assert.equal(parsedAgentRequest.messageType, "agent.execute.request");
  assert.equal(parsedAgentRequest.payload.agentTask.goal_type, "CHECKOUT_ENTRY_VERIFICATION");

  const replayHintAgentRequestRaw = await readFile(
    resolve(repoRoot, "packages/contracts/examples/sample-agent-execute-checkout-entry-replay-hints.request.json"),
    "utf8"
  );
  const parsedReplayHintAgentRequest = parseAgentExecuteMessage(replayHintAgentRequestRaw);
  assert.equal(parsedReplayHintAgentRequest.payload.agentTask.replay_hints?.steps.length, 1);

  const agentTrace = await readJson(resolve(repoRoot, "packages/contracts/examples/sample-agent-trace-checkout-entry.json"));
  const agentObservationSchema = await readJson(resolve(repoRoot, "packages/contracts/schemas/agent-observation.schema.json"));
  assert.equal(agentTrace.schema_version, "0.1");
  assert.equal(agentTrace.outcome.status, "SUCCESS");
  assert.ok(Array.isArray(agentTrace.turns));
  assert.ok(agentTrace.turns.length > 0);
  assert.ok(agentObservationSchema.properties.candidates);
  assert.ok(agentObservationSchema.properties.visibleTextSample);
  assert.ok(agentObservationSchema.properties.pageSignals);
});

test("[계약 동기화] runner callback literal이 packages/contracts callback schema와 어긋나지 않는다", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const callbackSchema = await readJson(resolve(repoRoot, "packages/contracts/internal/runner-callback.schema.json"));

  assertPropertyMatchesSchemaEnum(runnerTypesSource, "eventType", callbackSchema, callbackSchema.$defs.StepEvent.properties.eventType);
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "AgentCallbackEventType",
    callbackSchema,
    callbackSchema.$defs.AgentEvent.properties.eventType
  );
  assertPropertyMatchesSchemaEnum(runnerTypesSource, "artifactType", callbackSchema, callbackSchema.$defs.Artifact.properties.artifactType);
  assertPropertyMatchesSchemaEnum(
    runnerTypesSource,
    "resultCompleteness",
    callbackSchema,
    callbackSchema.$defs.Failed.properties.resultCompleteness
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "ScenarioStage",
    callbackSchema,
    callbackSchema.$defs.Checkpoint.properties.stage
  );
  assert.equal(callbackSchema.$defs.AgentEventBatch.properties.events.items.$ref, "../schemas/agent-event.schema.json");
  assert.equal(callbackSchema.$defs.AgentTraceRequest.properties.trace.$ref, "../schemas/agent-trace.schema.json");
  assert.ok(runnerTypesSource.includes("export interface AgentEventBatch"));
  assert.ok(runnerTypesSource.includes("export interface AgentTraceRequest"));
});

test("[계약 동기화] AgentTrace TS mirror가 packages/contracts trace schema와 어긋나지 않는다", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const callbackSchema = await readJson(resolve(repoRoot, "packages/contracts/internal/runner-callback.schema.json"));
  const outcomeSchema = await readJson(resolve(repoRoot, "packages/contracts/schemas/agent-outcome.schema.json"));
  const policySchema = await readJson(resolve(repoRoot, "packages/contracts/schemas/agent-policy-result.schema.json"));
  const traceExample = await readJson(resolve(repoRoot, "packages/contracts/examples/sample-agent-trace-checkout-entry.json"));

  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "AgentEventType",
    callbackSchema,
    callbackSchema.$defs.AgentEvent.properties.eventType
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "AgentOutcomeStatus",
    outcomeSchema,
    outcomeSchema.properties.status
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "AgentOutcomeReasonCode",
    outcomeSchema,
    outcomeSchema.properties.reason_code
  );
  assertTypeAliasMatchesSchemaEnum(
    runnerTypesSource,
    "AgentRiskClass",
    policySchema,
    policySchema.properties.riskClass
  );
  assert.equal(traceExample.outcome.status, "SUCCESS");
  assert.ok(traceExample.turns.some((turn: any) => turn.postActionVerification?.terminal === true));
});

async function readRunnerTypesSource(): Promise<string> {
  return readFile(resolve(repoRoot, "packages/contracts/types/runner.ts"), "utf8");
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

function extractTypeAliasStringUnion(source: string, typeName: string): string[] {
  const match = source.match(new RegExp(`export type ${escapeRegex(typeName)} =([\\s\\S]*?);`));
  assert.ok(match, `Unable to find type alias ${typeName}`);
  return extractStringLiterals(match[1]);
}

function extractPropertyStringUnion(source: string, propertyName: string): string[] {
  const match = source.match(new RegExp(`\\b${escapeRegex(propertyName)}\\??:\\s*([\\s\\S]*?);`));
  assert.ok(match, `Unable to find property ${propertyName}`);
  return extractStringLiterals(match[1]);
}

function extractPropertyPrimitiveType(source: string, propertyName: string): string {
  const match = source.match(new RegExp(`\\b${escapeRegex(propertyName)}\\??:\\s*(string|number|boolean)\\s*;`));
  assert.ok(match, `Unable to find primitive property ${propertyName}`);
  return match[1];
}

function extractStringLiterals(fragment: string): string[] {
  const matches = [...fragment.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(matches.length > 0, `No string literals found in fragment: ${fragment}`);
  return matches;
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSchemaPrimitiveType(value: string): string {
  return value === "integer" ? "number" : value;
}

function assertTypeAliasMatchesSchemaEnum(
  source: string,
  typeName: string,
  rootSchema: any,
  schemaNode: any
): void {
  assert.deepEqual(extractTypeAliasStringUnion(source, typeName), schemaEnum(rootSchema, schemaNode));
}

function assertPropertyMatchesSchemaEnum(
  source: string,
  propertyName: string,
  rootSchema: any,
  schemaNode: any
): void {
  assert.deepEqual(extractPropertyStringUnion(source, propertyName), schemaEnum(rootSchema, schemaNode));
}

function assertPropertyPrimitiveMatchesSchema(source: string, propertyName: string, schemaNode: any): void {
  assert.equal(extractPropertyPrimitiveType(source, propertyName), normalizeSchemaPrimitiveType(schemaNode.type));
}

function schemaEnum(rootSchema: any, schemaNode: any): string[] {
  const resolvedNode = resolveSchemaNode(rootSchema, schemaNode);
  if (Array.isArray(resolvedNode.enum)) {
    return resolvedNode.enum;
  }
  if (typeof resolvedNode.const === "string") {
    return [resolvedNode.const];
  }

  assert.fail(`Schema node does not expose enum/const: ${JSON.stringify(resolvedNode)}`);
}

function resolveSchemaNode(rootSchema: any, schemaNode: any): any {
  if (typeof schemaNode?.$ref !== "string") {
    return schemaNode;
  }

  assert.ok(schemaNode.$ref.startsWith("#/"), `Only local JSON pointers are supported: ${schemaNode.$ref}`);
  return schemaNode.$ref
    .slice(2)
    .split("/")
    .reduce((node: any, segment: string) => node?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], rootSchema);
}
