import assert from "node:assert/strict";
import test from "node:test";
import {
  assertScenarioActionAllowed,
  assertNavigationAllowed,
  assertVisitedUrlAllowed,
  createScenarioSafetyRecoveryState,
  evaluateScenarioSafetyRecovery,
  recordScenarioSafetyRecoveryAttempt,
  RunnerExecutionPolicyError
} from "../src/scenario/policy.ts";
import { createMinimalPlan } from "./support.ts";

test("[Scenario Policy] http/https 외부 origin 이동은 계속 차단한다", () => {
  const plan = createMinimalPlan();
  plan.start_url = "https://www.naver.com";

  assert.throws(
    () => assertVisitedUrlAllowed(plan, "https://example.com/signup"),
    (error) => {
      assert.ok(error instanceof RunnerExecutionPolicyError);
      assert.equal(error.safetyCode, "EXTERNAL_VISIT_BLOCKED");
      assert.equal(error.riskClass, "EXTERNAL_NAVIGATION");
      assert.equal(error.details.allowedOrigin, "https://www.naver.com");
      assert.equal(error.details.currentOrigin, "https://example.com");
      assert.match(error.message, /Scenario safety forbids visiting external origin https:\/\/example.com from start origin https:\/\/www.naver.com/);
      return true;
    }
  );
  assert.throws(
    () => assertNavigationAllowed(plan, "https://www.naver.com", "https://example.com/signup"),
    (error) => {
      assert.ok(error instanceof RunnerExecutionPolicyError);
      assert.equal(error.safetyCode, "EXTERNAL_NAVIGATION_BLOCKED");
      assert.equal(error.riskClass, "EXTERNAL_NAVIGATION");
      assert.equal(error.details.currentOrigin, "https://www.naver.com");
      assert.equal(error.details.nextOrigin, "https://example.com");
      assert.match(error.message, /Scenario safety forbids external navigation from https:\/\/www.naver.com to https:\/\/example.com/);
      return true;
    }
  );
});

test("[Scenario Policy] 외부 이동 safety block만 복구 가능한 block으로 분류한다", () => {
  const state = createScenarioSafetyRecoveryState();

  const externalNavigation = evaluateScenarioSafetyRecovery({
    safetyCode: "EXTERNAL_NAVIGATION_BLOCKED",
    stepKey: "step_001_click_login",
    details: {
      currentOrigin: "https://www.naver.com",
      nextOrigin: "https://nid.naver.com"
    },
    state
  });
  assert.equal(externalNavigation.recoverable, true);
  assert.equal(externalNavigation.reason, "RECOVERABLE_EXTERNAL_NAVIGATION");
  assert.equal(externalNavigation.strategy, "RETURN_TO_SAFE_ANCHOR");

  const externalVisit = evaluateScenarioSafetyRecovery({
    safetyCode: "EXTERNAL_VISIT_BLOCKED",
    stepKey: "step_002_verify_landing",
    details: {
      allowedOrigin: "https://www.naver.com",
      currentOrigin: "https://nid.naver.com"
    },
    state
  });
  assert.equal(externalVisit.recoverable, true);

  for (const safetyCode of ["PAYMENT_COMMIT_BLOCKED", "DESTRUCTIVE_ACTION_BLOCKED", "SYNTHETIC_INPUT_BLOCKED"] as const) {
    const decision = evaluateScenarioSafetyRecovery({
      safetyCode,
      stepKey: "step_003_risky_action",
      state
    });
    assert.equal(decision.recoverable, false);
    assert.equal(decision.reason, "NON_RECOVERABLE_SAFETY_BLOCK");
  }
});

test("[Scenario Policy] safety recovery는 step당 1회와 run 전체 횟수로 bounded 된다", () => {
  const firstDecision = evaluateScenarioSafetyRecovery({
    safetyCode: "EXTERNAL_NAVIGATION_BLOCKED",
    stepKey: "step_001_click_login",
    details: {
      currentOrigin: "https://www.naver.com",
      nextOrigin: "https://nid.naver.com"
    },
    state: createScenarioSafetyRecoveryState()
  });
  assert.equal(firstDecision.recoverable, true);

  const stateAfterFirstAttempt = recordScenarioSafetyRecoveryAttempt(createScenarioSafetyRecoveryState(), {
    stepKey: "step_001_click_login",
    fingerprint: firstDecision.fingerprint
  });

  const sameStepDecision = evaluateScenarioSafetyRecovery({
    safetyCode: "EXTERNAL_NAVIGATION_BLOCKED",
    stepKey: "step_001_click_login",
    details: {
      currentOrigin: "https://www.naver.com",
      nextOrigin: "https://nid.naver.com"
    },
    state: stateAfterFirstAttempt
  });
  assert.equal(sameStepDecision.recoverable, false);
  assert.equal(sameStepDecision.reason, "STEP_RECOVERY_LIMIT_REACHED");

  const runLimitState = {
    totalAttempts: 3,
    attemptsByStepKey: {
      step_001: 1,
      step_002: 1,
      step_003: 1
    },
    blockedFingerprints: ["step_001|x", "step_002|x", "step_003|x"]
  };
  const runLimitDecision = evaluateScenarioSafetyRecovery({
    safetyCode: "EXTERNAL_VISIT_BLOCKED",
    stepKey: "step_004",
    details: {
      allowedOrigin: "https://www.naver.com",
      currentOrigin: "https://nid.naver.com"
    },
    state: runLimitState
  });
  assert.equal(runLimitDecision.recoverable, false);
  assert.equal(runLimitDecision.reason, "RUN_RECOVERY_LIMIT_REACHED");
});

test("[Scenario Policy] 동일한 safety block fingerprint는 재복구하지 않는다", () => {
  const fingerprint = "step_001_click_login|EXTERNAL_NAVIGATION_BLOCKED|https://www.naver.com|https://nid.naver.com|";
  const decision = evaluateScenarioSafetyRecovery({
    safetyCode: "EXTERNAL_NAVIGATION_BLOCKED",
    stepKey: "step_001_click_login",
    details: {
      currentOrigin: "https://www.naver.com",
      nextOrigin: "https://nid.naver.com"
    },
    state: {
      totalAttempts: 0,
      attemptsByStepKey: {},
      blockedFingerprints: [fingerprint]
    }
  });

  assert.equal(decision.recoverable, false);
  assert.equal(decision.reason, "DUPLICATE_SAFETY_BLOCK");
});

test("[Scenario Policy] null-origin 브라우저 내부 URL은 외부 origin으로 오인하지 않는다", () => {
  const plan = createMinimalPlan();
  plan.start_url = "https://www.naver.com";

  assert.doesNotThrow(() => assertVisitedUrlAllowed(plan, "about:blank"));
  assert.doesNotThrow(() => assertVisitedUrlAllowed(plan, "data:text/html,blocked"));
  assert.doesNotThrow(() => assertNavigationAllowed(plan, "about:blank", "https://www.naver.com/search"));
});

test("[Scenario Policy] 안전 차단 error는 안정적인 code와 riskClass를 포함한다", () => {
  const plan = createMinimalPlan();

  assert.throws(
    () => assertScenarioActionAllowed(plan, plan.start_url, {
      type: "click",
      target: {
        text: "결제하기"
      }
    }),
    (error) => {
      assert.ok(error instanceof RunnerExecutionPolicyError);
      assert.equal(error.safetyCode, "PAYMENT_COMMIT_BLOCKED");
      assert.equal(error.riskClass, "PAYMENT_COMMIT");
      assert.equal(error.details.targetSummary, "text=결제하기");
      assert.match(error.message, /payment-commit/);
      return true;
    }
  );

  assert.throws(
    () => assertScenarioActionAllowed(plan, plan.start_url, {
      type: "click",
      target: {
        text: "회원 탈퇴"
      }
    }),
    (error) => {
      assert.ok(error instanceof RunnerExecutionPolicyError);
      assert.equal(error.safetyCode, "DESTRUCTIVE_ACTION_BLOCKED");
      assert.equal(error.riskClass, "DESTRUCTIVE_ACTION");
      assert.equal(error.details.targetSummary, "text=회원 탈퇴");
      assert.match(error.message, /destructive/);
      return true;
    }
  );

  plan.safety.use_synthetic_inputs = false;
  assert.throws(
    () => assertScenarioActionAllowed(plan, plan.start_url, {
      type: "fill",
      target: {
        label: "Email"
      },
      value: "tester@example.com"
    }),
    (error) => {
      assert.ok(error instanceof RunnerExecutionPolicyError);
      assert.equal(error.safetyCode, "SYNTHETIC_INPUT_BLOCKED");
      assert.equal(error.riskClass, "SYNTHETIC_INPUT");
      assert.equal(error.details.actionType, "fill");
      assert.match(error.message, /synthetic fill/);
      return true;
    }
  );
});
