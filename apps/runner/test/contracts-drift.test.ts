import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");

test("runner TypeScript mirror stays aligned with canonical scenario and MQ contract literals", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const scenarioSchema = await readJson(resolve(repoRoot, "packages/contracts/schemas/scenario-plan.schema.json"));
  const mqSchema = await readJson(resolve(repoRoot, "packages/contracts/mq/messages.schema.json"));

  assert.deepEqual(
    extractTypeAliasStringUnion(runnerTypesSource, "ScenarioActionType"),
    scenarioSchema.$defs.action.properties.type.enum
  );
  assert.deepEqual(
    extractTypeAliasStringUnion(runnerTypesSource, "SettleStrategyType"),
    scenarioSchema.$defs.settle_strategy.properties.type.enum
  );
  assert.deepEqual(extractTypeAliasStringUnion(runnerTypesSource, "ScenarioStage"), scenarioSchema.$defs.stage.enum);
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "scenario_type"),
    scenarioSchema.properties.scenario_type.enum
  );
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "device"),
    scenarioSchema.properties.environment.properties.device.enum
  );
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "auth_state"),
    scenarioSchema.properties.environment.properties.auth_state.enum
  );
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "triggerSource"),
    mqSchema.$defs.RunExecutePayload.properties.triggerSource.enum
  );
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "devicePreset"),
    mqSchema.$defs.RunExecutePayload.properties.devicePreset.enum
  );
  assert.deepEqual(extractPropertyStringUnion(runnerTypesSource, "messageType"), [mqSchema.$defs.RunExecuteMessage.properties.messageType.const]);
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "url_includes"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.url_includes.type)
  );
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "method"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.method.type)
  );
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "status"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.status.type)
  );
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "expected_count"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.expected_count.type)
  );
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "min_count"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.min_count.type)
  );
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "max_count"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.max_count.type)
  );
  assert.equal(
    extractPropertyPrimitiveType(runnerTypesSource, "count_delta"),
    normalizeSchemaPrimitiveType(scenarioSchema.$defs.settle_strategy.properties.count_delta.type)
  );
});

test("runner TypeScript mirror stays aligned with canonical runner callback literals", async () => {
  const runnerTypesSource = await readRunnerTypesSource();
  const callbackSchema = await readJson(resolve(repoRoot, "packages/contracts/internal/runner-callback.schema.json"));

  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "eventType"),
    callbackSchema.$defs.StepEvent.properties.eventType.enum
  );
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "artifactType"),
    callbackSchema.$defs.Artifact.properties.artifactType.enum
  );
  assert.deepEqual(
    extractPropertyStringUnion(runnerTypesSource, "resultCompleteness"),
    callbackSchema.$defs.Failed.properties.resultCompleteness.enum
  );
  assert.deepEqual(extractTypeAliasStringUnion(runnerTypesSource, "ScenarioStage"), callbackSchema.$defs.Checkpoint.properties.stage.enum);
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
