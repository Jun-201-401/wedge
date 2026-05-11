import assert from "node:assert/strict";
import test from "node:test";
import { createAgentTrace, createAgentTraceArtifact } from "../src/agent/trace.ts";
import { loadAgentExampleMessage } from "./support.ts";

test("[Agent Trace] AgentTask attempt_index를 trace와 TRACE artifact에 보존한다", async () => {
  const message = await loadAgentExampleMessage();
  const task = message.payload.agentTask;
  task.attempt_index = 7;

  const trace = createAgentTrace(task);
  const artifact = createAgentTraceArtifact(trace);

  assert.equal(trace.attempt_id, task.attempt_id);
  assert.equal(trace.attempt_index, 7);
  assert.match(artifact.content, /"attempt_index": 7/);
});
