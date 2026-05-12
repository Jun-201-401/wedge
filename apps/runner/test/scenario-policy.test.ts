import assert from "node:assert/strict";
import test from "node:test";
import { assertNavigationAllowed, assertVisitedUrlAllowed } from "../src/scenario/policy.ts";
import { createMinimalPlan } from "./support.ts";

test("[Scenario Policy] http/https 외부 origin 이동은 계속 차단한다", () => {
  const plan = createMinimalPlan();
  plan.start_url = "https://www.naver.com";

  assert.throws(
    () => assertVisitedUrlAllowed(plan, "https://example.com/signup"),
    /Scenario safety forbids visiting external origin https:\/\/example.com from start origin https:\/\/www.naver.com/
  );
  assert.throws(
    () => assertNavigationAllowed(plan, "https://www.naver.com", "https://example.com/signup"),
    /Scenario safety forbids external navigation from https:\/\/www.naver.com to https:\/\/example.com/
  );
});

test("[Scenario Policy] null-origin 브라우저 내부 URL은 외부 origin으로 오인하지 않는다", () => {
  const plan = createMinimalPlan();
  plan.start_url = "https://www.naver.com";

  assert.doesNotThrow(() => assertVisitedUrlAllowed(plan, "about:blank"));
  assert.doesNotThrow(() => assertVisitedUrlAllowed(plan, "data:text/html,blocked"));
  assert.doesNotThrow(() => assertNavigationAllowed(plan, "about:blank", "https://www.naver.com/search"));
});
