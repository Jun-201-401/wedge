import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeliveryIssue,
  createDeliverySummary,
  resolveDeliveryIssueImpact
} from "../src/delivery/index.ts";

test("[Delivery policy] checkpoint/artifact callback 실패는 partial delivery로 남긴다", () => {
  const issue = createDeliveryIssue({
    scope: "checkpoints-callback",
    stepKey: "step_001",
    message: "checkpoint callback failed"
  });

  assert.equal(resolveDeliveryIssueImpact(issue), "partial");
  assert.equal(issue.impact, "partial");
  assert.equal(createDeliverySummary([issue]).status, "DELIVERY_PARTIAL");
});

test("[Delivery policy] finished callback 실패는 terminal delivery failed로 승격한다", () => {
  const issue = createDeliveryIssue({
    scope: "finished-callback",
    message: "finished callback failed"
  });

  assert.equal(resolveDeliveryIssueImpact(issue), "fatal");
  assert.equal(issue.impact, "fatal");
  assert.equal(createDeliverySummary([issue]).status, "DELIVERY_FAILED");
});
