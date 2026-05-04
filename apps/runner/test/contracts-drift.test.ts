import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
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
  assertPropertyMatchesSchemaEnum(runnerTypesSource, "messageType", mqSchema, mqSchema.$defs.RunExecuteMessage.properties.messageType);

  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "url_includes", scenarioSchema.$defs.settle_strategy.properties.url_includes);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "method", scenarioSchema.$defs.settle_strategy.properties.method);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "status", scenarioSchema.$defs.settle_strategy.properties.status);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "expected_count", scenarioSchema.$defs.settle_strategy.properties.expected_count);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "min_count", scenarioSchema.$defs.settle_strategy.properties.min_count);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "max_count", scenarioSchema.$defs.settle_strategy.properties.max_count);
  assertPropertyPrimitiveMatchesSchema(runnerTypesSource, "count_delta", scenarioSchema.$defs.settle_strategy.properties.count_delta);
});

test("[계약 동기화] runner callback literal이 packages/contracts callback schema와 어긋나지 않는다", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const callbackSchema = await readJson(resolve(repoRoot, "packages/contracts/internal/runner-callback.schema.json"));

  assertPropertyMatchesSchemaEnum(runnerTypesSource, "eventType", callbackSchema, callbackSchema.$defs.StepEvent.properties.eventType);
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
