import assert from "node:assert/strict";
import test from "node:test";
import {
  assertScenarioActionAllowed,
  assertNavigationAllowed,
  assertVisitedUrlAllowed,
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
