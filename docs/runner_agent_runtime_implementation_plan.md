---
title: Runner Agent Runtime Implementation Plan
document_type: implementation-plan
status: proposal
last_updated: 2026-05-07
intended_use:
  - implementation_handoff
  - contract_design
  - runner_agent_execution
related_documents:
  - wedge_runner_architecture.md
  - 01_architecture_and_project_structure.md
  - 04_domain_payload_contracts.md
  - AI_CONTEXT_GUIDE.md
---

# 1. Objective

Implement a constrained Browser Agent Runtime for Wedge without corrupting the existing deterministic `ScenarioPlan` Runner model.

The target MVP is:

```text
Checkout Entry Agent
```

It should start from a URL, explore a site with bounded browser actions, and determine whether a checkout/cart/shipping/payment-entry path exists before real payment or final order commit.

This plan is written so an implementer can proceed from this document alone, while still respecting the repository's contract-first rule.

# 2. Non-goals

Do not implement a fully autonomous browser that can do arbitrary work.

Do not ask the LLM to generate Playwright code, JavaScript, CSS selectors, shell commands, or arbitrary tool calls.

Do not merge agent behavior into `ScenarioPlan` as optional hints, fallback selectors, branch logic, or recovery state.

Do not complete real purchases, submit final orders, solve CAPTCHA, invent credentials, enter real payment instruments, or bypass login/bot gates.

Do not rely on real ecommerce sites as the only test environment.

# 3. Current Baseline

Current Runner behavior:

```text
run.execute.request
-> payload.scenarioPlan
-> create browser session
-> accepted callback
-> execute ScenarioPlan steps in order
-> emit step/artifact/checkpoint callbacks
-> finished or failed callback
-> close browser session
```

Current `ScenarioPlan` is a deterministic replay contract:

```text
schema_version = "0.5"
plan_id
scenario_type = template | custom_compiled
goal
start_url
environment
safety
steps[]
```

Current step action types:

```text
goto
click
fill
select
scroll
hover
wait_for
checkpoint
stop_when
```

Current target descriptors can include:

```text
role
text
text_any
label
label_any
placeholder
placeholder_any
name
name_any
href_contains
selector
selector_any
url
```

Current Runner already converts action JSON into Playwright calls through fixed code. The agent runtime should preserve this principle:

```text
LLM decision JSON
-> schema validation
-> candidate resolution
-> policy check
-> fixed Playwright tool execution
-> observation
-> verification
```

# 4. Target Architecture

Add a separate agent runtime beside the current scenario executor.

Recommended module shape:

```text
apps/runner/src/agent/
  session.ts
  observer.ts
  candidates.ts
  redaction.ts
  decision/
    index.ts
    heuristic-client.ts
    llm-client.ts
    mock-client.ts
  policy.ts
  verifier.ts
  trace.ts
  tools.ts
  outcomes.ts

apps/runner/src/worker/
  index.ts
  agent-worker.ts

apps/runner/test/agent/
  fixtures/
  observer.test.ts
  candidates.test.ts
  policy.test.ts
  verifier.test.ts
  heuristic-agent.test.ts
  trace.test.ts
```

Keep these responsibilities separate:

```text
Scenario executor:
- deterministic ScenarioPlan replay
- static run callbacks
- existing evidence flow

Agent runtime:
- observe current page
- extract candidates
- choose next action using heuristic or LLM decision client
- validate decision
- apply risk policy
- execute constrained tools
- verify progress
- record AgentTrace
- optionally export stable path to ScenarioPlan candidate
```

## 4.1 Dependency Boundaries

Keep dependency direction explicit:

```text
apps/runner/src/worker
  -> may depend on scenario and agent

apps/runner/src/scenario
  -> may depend on browser/capture/storage/callback/contracts
  -> must not depend on agent

apps/runner/src/agent
  -> may depend on browser/capture/contracts
  -> may depend on storage interfaces only where needed for artifact refs
  -> should not depend on scenario executor internals
  -> must not emit callbacks directly

apps/runner/src/worker/agent-worker.ts
  -> owns agent lifecycle orchestration
  -> owns callback emission or injects a callback port into the agent runtime

apps/runner/src/agent/trace-export
  -> may depend on ScenarioPlan contract
  -> must not depend on ScenarioPlan executor internals
```

Allowed conversion path:

```text
AgentTrace
-> trace-to-scenario-plan converter
-> ScenarioPlan JSON
-> existing ScenarioPlan validator/static executor
```

Disallowed coupling:

```text
Scenario executor importing agent modules.
Agent runtime calling scenario executor internals during exploration.
Agent policy reusing broad static scenario payment keyword blocking as the source of truth.
```

## 4.2 Worker and Queue Isolation

Agent jobs are heavier than static scenario jobs. They may loop, observe repeatedly, capture more artifacts, and eventually call an LLM. Do not let agent jobs starve deterministic `run.execute.request` jobs.

MVP requirement:

```text
Same apps/runner process is acceptable.
Static run and agent execution paths must have separate queue/routing configuration.
Agent concurrency must be separately configurable and default lower than static run concurrency.
```

Recommended config:

```text
RUNNER_MQ_QUEUE_RUN_EXECUTE=run.execute.request
RUNNER_MQ_QUEUE_DISCOVERY_EXECUTE=discovery.execute.request
RUNNER_MQ_QUEUE_AGENT_EXECUTE=agent.execute.request
RUNNER_MQ_PREFETCH=4
RUNNER_AGENT_CONCURRENCY=1
```

Discovery queue/routing remains the existing discovery behavior. Agent isolation is about preventing long-running agent jobs from starving deterministic `run.execute.request` jobs; it does not remove or merge `discovery.execute.request`.

If the current RabbitMQ consumer abstraction only supports one prefetch/concurrency value, update the runtime before enabling agent MQ consumption.

Current implementation checkpoint:

```text
Implemented in apps/runner:
- run.execute.request and discovery.execute.request continue to use RUNNER_MQ_PREFETCH.
- agent.execute.request uses separate RUNNER_AGENT_CONCURRENCY.
- RabbitMQ consumers use separate channels so agent prefetch does not consume the shared run/discovery channel budget.
- RUNNER_AGENT_CONCURRENCY defaults to 1 and rejects non-positive values.
```

# 5. Contract-first Work

Create new contracts before application wiring.

Add new contract files:

```text
packages/contracts/schemas/agent-task.schema.json
packages/contracts/schemas/agent-observation.schema.json
packages/contracts/schemas/agent-decision.schema.json
packages/contracts/schemas/agent-policy-result.schema.json
packages/contracts/schemas/agent-verification-result.schema.json
packages/contracts/schemas/agent-event.schema.json
packages/contracts/schemas/agent-outcome.schema.json
packages/contracts/schemas/agent-trace.schema.json
packages/contracts/mq/agent.execute.request.schema.json
packages/contracts/examples/sample-agent-execute-checkout-entry.request.json
packages/contracts/examples/sample-agent-trace-checkout-entry.json
```

Centralize shared enums instead of copying string enums across schemas. Use one shared schema definition file or dedicated enum files for:

```text
goal_type
decision_type
agent_tool
risk_class
verification_status
goal_progress
final_outcome
page_kind
agent_event_type
```

Update existing contract files:

```text
packages/contracts/mq/messages.schema.json
packages/contracts/types/runner.ts
```

Do not remove or break:

```text
run.execute.request
ScenarioPlan
runner callback payloads
existing sample ScenarioPlan examples
```

## 5.1 AgentExecuteMessage

Add a new MQ message type:

```text
messageType = "agent.execute.request"
```

Required envelope:

```json
{
  "messageId": "uuid-or-stable-id",
  "messageType": "agent.execute.request",
  "schemaVersion": "0.1",
  "createdAt": "2026-05-06T00:00:00.000Z",
  "producer": "api-server",
  "correlationId": "optional",
  "idempotencyKey": "optional",
  "payload": {
    "agentTask": {}
  }
}
```

## 5.2 AgentTask

Initial schema:

```json
{
  "schema_version": "0.1",
  "task_id": "agent-task-uuid",
  "attempt_id": "attempt-uuid",
  "attempt_index": 1,
  "idempotency_key": "optional-idempotency-key",
  "run_id": "run-uuid",
  "project_id": "project-uuid",
  "goal_type": "CHECKOUT_ENTRY_VERIFICATION",
  "start_url": "https://example.com",
  "environment": {
    "device": "desktop",
    "viewport": {
      "width": 1440,
      "height": 900
    },
    "locale": "ko-KR",
    "timezone": "Asia/Seoul",
    "auth_state": "anonymous"
  },
  "budget": {
    "max_steps": 20,
    "max_duration_ms": 120000,
    "max_recovery_attempts": 3,
    "max_same_page_attempts": 3,
    "max_external_redirects": 1
  },
  "observation_budget": {
    "max_candidates": 80,
    "max_visible_text_chars": 6000,
    "max_nearby_text_chars_per_candidate": 300,
    "max_dom_snapshot_bytes": 1000000,
    "max_ax_tree_bytes": 1000000,
    "max_artifacts_per_run": 80,
    "max_artifact_bytes_per_run": 5000000
  },
  "allowed_navigation": {
    "allow_external_navigation": false,
    "allowed_origins": ["https://example.com"],
    "allowed_checkout_redirect_origins": []
  },
  "product_selection_policy": {
    "mode": "PROVIDED_OR_OBVIOUS_ONLY",
    "provided_product_url": null,
    "required_option_strategy": "FIRST_AVAILABLE",
    "allow_quantity_change": false,
    "max_add_to_cart_attempts": 1
  },
  "risk_policy": {
    "allow_checkout_navigation": true,
    "allow_cart_mutation": true,
    "allow_shipping_form_entry": true,
    "allow_payment_info_entry": false,
    "allow_final_payment_submit": false,
    "allow_final_order_commit": false,
    "allow_destructive_action": false,
    "allow_external_message_send": false
  },
  "test_data": {
    "email": "test@example.com",
    "name": "Test User",
    "phone": "01000000000",
    "shipping_address": null,
    "postal_code": null,
    "country": "KR",
    "coupon_code": null,
    "sandbox_payment": null
  },
  "artifact_policy": {
    "capture_screenshots": true,
    "capture_dom_snapshots": true,
    "capture_ax_tree": true,
    "capture_trace": true
  }
}
```

Rules:

```text
goal_type initially supports only CHECKOUT_ENTRY_VERIFICATION.
attempt_id identifies a single execution attempt for retry/debugging.
LLM provider config does not belong in AgentTask; use Runner config.
Missing non-payment test data should produce typed blocker outcomes.
Payment test data is allowed only through sandbox_payment and explicit risk policy.
MVP product selection is not arbitrary catalog browsing. Start URL should be a product page, cart page, pricing page, or landing page with an obvious purchase CTA. Otherwise return FAILED_NO_CHECKOUT_PATH_FOUND or a narrower typed blocker.
```

## 5.3 AgentObservation

Initial schema:

```json
{
  "schema_version": "0.1",
  "observation_id": "obs-uuid",
  "task_id": "agent-task-uuid",
  "step_index": 3,
  "captured_at": "2026-05-06T00:00:00.000Z",
  "url": "https://example.com/cart",
  "origin": "https://example.com",
  "title": "Cart",
  "page_kind": "CART",
  "visible_headings": ["Cart"],
  "visible_text_sample": ["Subtotal", "Proceed to checkout"],
  "forms": [
    {
      "form_id": "form-1",
      "kind_hint": "SHIPPING_OR_CONTACT",
      "fields": [
        {
          "candidate_id": "field-1",
          "label": "Email",
          "type": "email",
          "required": true,
          "is_visible": true,
          "is_enabled": true
        }
      ]
    }
  ],
  "candidates": [
    {
      "candidate_id": "candidate-1",
      "candidate_fingerprint": "hash",
      "role": "button",
      "text": "Proceed to checkout",
      "accessible_name": "Proceed to checkout",
      "tag_name": "button",
      "input_type": null,
      "href": null,
      "form_action": null,
      "form_method": null,
      "is_visible": true,
      "is_enabled": true,
      "is_in_viewport": true,
      "is_covered_or_occluded": "false",
      "occlusion_reason": null,
      "bounding_box": {
        "x": 100,
        "y": 400,
        "width": 180,
        "height": 44,
        "unit": "css_px"
      },
      "frame_id": "main",
      "shadow_root_path": null,
      "locator_recipe": {
        "frame_id": "main",
        "role": "button",
        "text": "Proceed to checkout"
      },
      "kind_hint": "CHECKOUT_CTA",
      "risk_hint": "CHECKOUT_NAVIGATION",
      "confidence": 0.86,
      "source": ["AX_TREE", "DOM", "HEURISTIC"],
      "nearby_text": ["Subtotal", "Cart"],
      "parent_section_heading": "Cart",
      "language_hint": "en"
    }
  ],
  "risk_candidates": [],
  "artifact_refs": {
    "screenshot": "artifact-id",
    "dom_snapshot": "artifact-id",
    "ax_tree": "artifact-id"
  }
}
```

Rules:

```text
candidate_id is observation-scoped and expires after the next observation.
candidate_fingerprint is for trace/replay/export analysis only.
Runtime must reject decisions referencing stale or unknown candidate_id.
locator_recipe is internal execution data and must use only supported locator forms.
is_covered_or_occluded is "true" | "false" | "unknown"; do not claim false when the observer cannot determine clickability.
frame_id must be present for candidates from iframes. Tool runtime must resolve locators in the correct frame.
```

## 5.4 AgentDecision

Initial schema:

```json
{
  "schema_version": "0.1",
  "decision_id": "decision-uuid",
  "task_id": "agent-task-uuid",
  "observation_id": "obs-uuid",
  "decision_type": "ACT",
  "action": {
    "tool": "click",
    "candidate_id": "candidate-1",
    "value": null,
    "options": {}
  },
  "expected_outcome": {
    "page_kind_any_of": ["CHECKOUT", "SHIPPING", "PAYMENT_ENTRY"],
    "visible_text_includes_any": ["checkout", "shipping", "payment", "주문", "결제"],
    "url_includes_any": ["checkout", "order", "cart", "payment", "shipping"]
  },
  "reason": "Candidate appears to proceed to checkout.",
  "risk_assessment": {
    "llm_risk": "LOW",
    "risk_class_hint": "CHECKOUT_NAVIGATION"
  }
}
```

Allowed `decision_type`:

```text
ACT
STOP_SUCCESS
STOP_BLOCKED
FAIL
```

Allowed `tool` values for MVP:

```text
goto
back
reload
click
fill
select
check
uncheck
hover
scroll
press_key
wait_for_text
wait_for_url
wait_for_network_idle
wait_for_dom_stability
capture
stop
fail
```

Rules:

```text
Decision JSON must be schema-validated before policy.
Decision action must reference the latest observation_id.
LLM cannot introduce tools outside the enum.
LLM cannot provide arbitrary JavaScript or arbitrary Playwright code.
LLM cannot provide raw CSS selectors for execution in MVP.
STOP_SUCCESS from any DecisionClient is only a suggestion. Runtime must confirm it through AgentVerifier before producing a SUCCESS_* outcome.
```

## 5.5 AgentPolicyResult

Initial schema:

```json
{
  "schema_version": "0.1",
  "policy_result_id": "policy-uuid",
  "task_id": "agent-task-uuid",
  "decision_id": "decision-uuid",
  "observation_id": "obs-uuid",
  "allowed": true,
  "risk_class": "CHECKOUT_NAVIGATION",
  "reason": "Checkout navigation is allowed by current risk policy.",
  "matched_rules": ["allow_checkout_navigation"]
}
```

## 5.6 AgentVerificationResult

Initial schema:

```json
{
  "schema_version": "0.1",
  "verification_id": "verification-uuid",
  "task_id": "agent-task-uuid",
  "after_observation_id": "obs-uuid",
  "status": "PROGRESS",
  "goal_progress": "CART_REACHED",
  "confidence": 0.78,
  "evidence": {
    "url_includes": ["cart"],
    "visible_text_includes": ["Cart", "Checkout"],
    "page_kind": "CART",
    "forms_detected": [],
    "next_risky_candidate": null,
    "artifact_refs": ["artifact-screenshot", "artifact-dom"]
  }
}
```

Allowed `status`:

```text
SUCCESS
PROGRESS
BLOCKED
FAILED
INSUFFICIENT_EVIDENCE
```

Allowed `goal_progress` for MVP:

```text
STARTED
PRODUCT_OR_PRICING_REACHED
CART_REACHED
CHECKOUT_ENTRY_REACHED
SHIPPING_ENTRY_REACHED
PAYMENT_ENTRY_REACHED
FINAL_COMMIT_DETECTED
NO_PROGRESS
```

## 5.7 AgentTrace

Initial schema:

```json
{
  "schema_version": "0.1",
  "trace_id": "trace-uuid",
  "task_id": "agent-task-uuid",
  "run_id": "run-uuid",
  "started_at": "2026-05-06T00:00:00.000Z",
  "finished_at": "2026-05-06T00:01:10.000Z",
  "final_outcome": "SUCCESS_CHECKOUT_ENTRY_REACHED",
  "events": [
    {
      "event_id": "event-1",
      "task_id": "agent-task-uuid",
      "attempt_id": "attempt-uuid",
      "run_id": "run-uuid",
      "step_index": 1,
      "event_type": "AGENT_OBSERVATION_CAPTURED",
      "occurred_at": "2026-05-06T00:00:01.000Z",
      "payload": {
        "observation_id": "obs-1"
      }
    },
    {
      "event_id": "event-2",
      "task_id": "agent-task-uuid",
      "attempt_id": "attempt-uuid",
      "run_id": "run-uuid",
      "step_index": 1,
      "event_type": "AGENT_DECISION_RECEIVED",
      "occurred_at": "2026-05-06T00:00:02.000Z",
      "payload": {
        "decision_id": "decision-1"
      }
    },
    {
      "event_id": "event-3",
      "task_id": "agent-task-uuid",
      "attempt_id": "attempt-uuid",
      "run_id": "run-uuid",
      "step_index": 1,
      "event_type": "AGENT_POLICY_ALLOWED",
      "occurred_at": "2026-05-06T00:00:02.100Z",
      "payload": {
        "policy_result_id": "policy-1"
      }
    },
    {
      "event_id": "event-4",
      "task_id": "agent-task-uuid",
      "attempt_id": "attempt-uuid",
      "run_id": "run-uuid",
      "step_index": 1,
      "event_type": "AGENT_ACTION_COMPLETED",
      "occurred_at": "2026-05-06T00:00:03.000Z",
      "payload": {
        "tool": "click",
        "candidate_id": "candidate-1"
      }
    },
    {
      "event_id": "event-5",
      "task_id": "agent-task-uuid",
      "attempt_id": "attempt-uuid",
      "run_id": "run-uuid",
      "step_index": 1,
      "event_type": "AGENT_VERIFICATION_COMPLETED",
      "occurred_at": "2026-05-06T00:00:04.000Z",
      "payload": {
        "verification_id": "verification-1"
      }
    }
  ],
  "observations": [],
  "decisions": [],
  "policy_results": [],
  "verification_results": [],
  "artifact_refs": []
}
```

Trace event types:

```text
AGENT_OBSERVATION_CAPTURED
AGENT_CANDIDATES_EXTRACTED
AGENT_DECISION_REQUESTED
AGENT_DECISION_RECEIVED
AGENT_DECISION_VALIDATED
AGENT_POLICY_ALLOWED
AGENT_POLICY_BLOCKED
AGENT_ACTION_STARTED
AGENT_ACTION_COMPLETED
AGENT_ACTION_FAILED
AGENT_SETTLE_COMPLETED
AGENT_VERIFICATION_COMPLETED
AGENT_RECOVERY_ATTEMPTED
AGENT_TRACE_EXPORTED_TO_SCENARIO_PLAN
AGENT_STOPPED
AGENT_FAILED
```

## 5.8 AgentEvent

Define `AgentEvent` as a reusable event schema so callbacks and trace events do not drift.

Initial schema:

```json
{
  "schema_version": "0.1",
  "event_id": "event-uuid",
  "task_id": "agent-task-uuid",
  "attempt_id": "attempt-uuid",
  "run_id": "run-uuid",
  "step_index": 3,
  "event_type": "AGENT_OBSERVATION_CAPTURED",
  "occurred_at": "2026-05-06T00:00:04.000Z",
  "payload": {
    "observation_id": "obs-uuid"
  }
}
```

Use `AgentEvent` for:

```text
agent callback payloads
AgentTrace.events[]
test golden event expectations
```

Canonical rule:

```text
AgentTrace.events[] contains AgentEvent objects.
Use event_type with AGENT_* enum values everywhere.
Do not introduce a second trace-local event field named type.
```

## 5.9 AgentOutcome

Define final outcomes in one schema/enum and reference them from `AgentTrace`, callbacks, worker results, and tests.

Initial schema concept:

```json
{
  "schema_version": "0.1",
  "final_outcome": "SUCCESS_CHECKOUT_ENTRY_REACHED",
  "category": "SUCCESS",
  "terminal": true,
  "reason": "Checkout entry verified with URL and visible text evidence.",
  "evidence_refs": ["artifact-screenshot", "artifact-dom"],
  "verification_id": "verification-uuid",
  "policy_result_id": null
}
```

Allowed categories:

```text
SUCCESS
POLICY_BLOCKED
BLOCKED
FAILED
```

# 6. Outcome Taxonomy

Add explicit final outcomes:

```text
SUCCESS_CHECKOUT_ENTRY_REACHED
SUCCESS_SHIPPING_ENTRY_REACHED
SUCCESS_PAYMENT_ENTRY_REACHED_AND_STOPPED
POLICY_BLOCKED_FINAL_PAYMENT_SUBMIT
POLICY_BLOCKED_FINAL_ORDER_COMMIT
POLICY_BLOCKED_DESTRUCTIVE_ACTION
POLICY_BLOCKED_EXTERNAL_NAVIGATION
BLOCKED_MISSING_TEST_DATA
BLOCKED_LOGIN_REQUIRED
BLOCKED_CAPTCHA
BLOCKED_AGE_GATE
BLOCKED_BOT_DETECTION
FAILED_NO_CHECKOUT_PATH_FOUND
FAILED_ACTION_TARGET_NOT_RESOLVED
FAILED_ACTION_RESULT_MISMATCH
FAILED_TIMEOUT
FAILED_RUNTIME_ERROR
FAILED_VERIFICATION_INSUFFICIENT_EVIDENCE
```

Rules:

```text
Use BLOCKED when the system understands the blocker and should not continue.
Use POLICY_BLOCKED when policy intentionally prevents a risky action.
Use FAILED when the agent/runtime could not complete the task for technical or search reasons.
Use SUCCESS_* only when verifier has structured evidence.
```

# 7. Risk Taxonomy

Replace broad payment keyword blocking in agent policy with explicit risk classes.

Risk classes:

```text
SAFE_NAVIGATION
CHECKOUT_NAVIGATION
CART_ADD_ITEM
CART_REMOVE_ITEM
CART_QUANTITY_INCREASE
CART_QUANTITY_DECREASE
NON_PAYMENT_FORM_ENTRY
SHIPPING_FORM_ENTRY
PAYMENT_INFO_ENTRY
ORDER_REVIEW_NAVIGATION
FINAL_PAYMENT_SUBMIT
FINAL_ORDER_COMMIT
DESTRUCTIVE_ACCOUNT_ACTION
EXTERNAL_MESSAGE_SEND
LOGIN_CREDENTIAL_ENTRY
CAPTCHA_OR_BOT_CHALLENGE
UNKNOWN_HIGH_RISK
UNKNOWN_LOW_RISK
```

Default policy:

```text
SAFE_NAVIGATION              allow
CHECKOUT_NAVIGATION          allow
CART_ADD_ITEM                allow within max_add_to_cart_attempts
CART_REMOVE_ITEM             block by default in MVP
CART_QUANTITY_INCREASE       block by default in MVP
CART_QUANTITY_DECREASE       block by default in MVP
NON_PAYMENT_FORM_ENTRY       allow with provided synthetic test data
SHIPPING_FORM_ENTRY          allow with provided synthetic test data
ORDER_REVIEW_NAVIGATION      allow
PAYMENT_INFO_ENTRY           block unless sandbox payment policy is explicit
FINAL_PAYMENT_SUBMIT         hard block by default
FINAL_ORDER_COMMIT           hard block by default
DESTRUCTIVE_ACCOUNT_ACTION   hard block by default
EXTERNAL_MESSAGE_SEND        hard block by default
LOGIN_CREDENTIAL_ENTRY       block unless stored/test auth policy is explicit
CAPTCHA_OR_BOT_CHALLENGE     blocked outcome
UNKNOWN_HIGH_RISK            block
UNKNOWN_LOW_RISK             allow only for navigation/observation tools
```

Classification inputs:

```text
candidate text
accessible name
href
form action
button type
nearby text
parent section heading
page kind
current URL
candidate role/tag
language hint
known checkout/payment keywords
known final commit keywords
```

Korean examples:

```text
장바구니             CART
장바구니 담기        CART_ADD_ITEM
주문하기             context-dependent: CHECKOUT_NAVIGATION or FINAL_ORDER_COMMIT
결제하기             context-dependent: CHECKOUT_NAVIGATION, PAYMENT_INFO_ENTRY, or FINAL_PAYMENT_SUBMIT
배송지               SHIPPING_FORM_ENTRY
구매 확정            FINAL_ORDER_COMMIT
결제 완료            FINAL_PAYMENT_SUBMIT or FINAL_ORDER_COMMIT
```

MVP cart mutation rule:

```text
Only add-to-cart is allowed by default.
Repeated add-to-cart for the same candidate_fingerprint is blocked after max_add_to_cart_attempts.
Remove item and quantity changes are excluded from MVP because they can erase the path or alter order state.
```

## 7.1 Navigation Policy

Navigation policy must handle ordinary canonical redirects without opening broad external browsing.

Rules:

```text
Record the initial redirect chain from start_url.
Treat the final origin after http->https or www/non-www canonical redirect as an allowed origin candidate.
Do not infer arbitrary subdomains as allowed.
External checkout origins are allowed only when listed in allowed_checkout_redirect_origins.
If navigation reaches an unallowed external origin, capture evidence and stop with POLICY_BLOCKED_EXTERNAL_NAVIGATION.
If an allowlisted checkout origin is reached, it may count as checkout entry, but final payment/order actions remain blocked.
```

Examples:

```text
http://example.com -> https://example.com
  allowed as canonical redirect.

https://example.com -> https://www.example.com
  allowed only if canonical redirect policy accepts www normalization or final origin is added during initial redirect capture.

https://shop.example.com -> https://checkout.payment-provider.example
  allowed only when explicitly listed in allowed_checkout_redirect_origins.
```

# 8. Agent Loop State Machine

Implement the runtime as an explicit state machine:

```text
INITIALIZING
OBSERVING
PRE_DECISION_VERIFYING
DECIDING
VALIDATING_DECISION
POLICY_CHECKING
ACTING
SETTLING
VERIFYING
RECOVERING
STOPPED_SUCCESS
STOPPED_POLICY_BLOCKED
STOPPED_BLOCKER
FAILED
```

Main loop:

```text
1. INITIALIZING
   - validate AgentTask
   - create browser session
   - navigate to start_url
   - create trace

2. OBSERVING
   - capture URL/title/page text
   - capture screenshot/DOM/AX artifacts according to artifact_policy
   - extract forms and candidates
   - classify page_kind
   - record observation

3. PRE_DECISION_VERIFYING
   - run AgentVerifier immediately after every observation
   - stop before asking DecisionClient when success/blocker/policy-stop is already evident
   - examples: payment-entry page reached, login wall detected, CAPTCHA detected, final commit candidate visible

4. DECIDING
   - ask DecisionClient for next decision
   - MVP starts with HeuristicDecisionClient
   - LLMDecisionClient comes after heuristic baseline passes fixtures

5. VALIDATING_DECISION
   - validate JSON schema
   - ensure observation_id matches latest observation
   - ensure candidate_id exists for candidate-targeted actions
   - reject unsupported tool

6. POLICY_CHECKING
   - classify risk
   - evaluate task risk_policy
   - record AgentPolicyResult
   - stop with policy outcome on hard block

7. ACTING
   - execute constrained Playwright tool
   - no arbitrary JS
   - no raw selector generated by LLM

8. SETTLING
   - wait for network/DOM stability or bounded timeout
   - capture action result

9. VERIFYING
   - observe again
   - evaluate goal progress
   - stop on success/blocker/failure
   - otherwise continue

10. RECOVERING
   - bounded recovery only
   - then continue or fail
```

Safety rule:

```text
Every observation must be verified before the next decision is requested.
This prevents the agent from asking an LLM what to click after the goal is already reached or a final payment/order action is visible.
```

Budget stop conditions:

```text
elapsed time > max_duration_ms
step count > max_steps
same page attempts > max_same_page_attempts
recovery attempts > max_recovery_attempts
external redirects > max_external_redirects
```

# 9. Tool Runtime

Implement tools as fixed code. The decision client chooses only tool name and validated arguments.

MVP tool behavior:

```text
goto(url)
- allowed only for start_url or policy-allowed navigation.

back()
- page.goBack with bounded wait.

reload()
- page.reload with bounded wait.

click(candidateId)
- resolve latest observation candidate.
- ensure visible/enabled/not stale.
- resolve frame_id before locator execution.
- scroll into view if needed.
- locator.click.

fill(candidateId, value)
- allowed only for form field candidates.
- value must come from AgentTask.test_data or explicit non-sensitive generated fixture value.

select(candidateId, value)
- use value or label.

check/uncheck(candidateId)
- only checkbox/radio candidates.

hover(candidateId)
- use locator.hover.

scroll(direction, amount)
- page-level scroll.

press_key(candidateId?, key)
- allowed key enum only: Enter, Escape, Tab, ArrowUp, ArrowDown.

wait_for_text(text)
- bounded wait for visible text.

wait_for_url(pattern)
- bounded URL match.

wait_for_network_idle()
- bounded load state wait.

wait_for_dom_stability()
- bounded repeated DOM/candidate count stability check.

capture()
- force screenshot/DOM/AX artifact capture.

stop(reason)
- terminal controlled stop.

fail(reason)
- terminal failure.
```

Explicitly reject:

```text
evaluate/javascript execution requested by decision client
raw CSS selector provided by LLM
file system access
network calls outside browser page
credential generation
payment data generation
```

Frame and shadow DOM rules:

```text
locator_recipe must include frame_id for iframe candidates.
tools.ts must resolve frame_id to the correct Playwright Frame or frameLocator before executing.
main-frame and child-frame candidate IDs must not collide.
MVP must at least observe iframe risky candidates and block final commit/payment actions inside iframes.
Shadow DOM support may be observation-only in MVP unless locator_recipe can safely resolve it.
```

# 10. Observer and Candidate Extraction

Implement observer in layers.

Required MVP observation sources:

```text
URL/title
visible headings and visible text sample
DOM candidate extraction
Playwright locator metadata where feasible
screenshot artifact
DOM snapshot artifact
AX tree artifact if enabled and available
console/network errors from existing browser session observers
```

Observation size and privacy rules:

```text
Apply AgentTask.observation_budget before trace persistence or LLM prompt construction.
Limit candidate count and visible text length.
Store full DOM/AX data as bounded artifacts, not unbounded inline trace fields.
Run redaction before observations are persisted, sent to callbacks, logged, or used in LLM prompts.
```

Candidate extraction targets:

```text
links
buttons
inputs
selects
textareas
checkboxes/radios
elements with role button/link/menuitem
forms and submit buttons
modal/dialog close buttons
cookie banner action buttons
cart drawer action buttons
```

Candidate fields to populate:

```text
candidate_id
candidate_fingerprint
role
text
accessible_name
tag_name
input_type
href
form_action
form_method
is_visible
is_enabled
is_in_viewport
is_covered_or_occluded
bounding_box
frame_id
shadow_root_path
locator_recipe
kind_hint
risk_hint
confidence
source
nearby_text
parent_section_heading
language_hint
```

Candidate ID rules:

```text
candidate_id = "candidate-{stepIndex}-{ordinal}" or equivalent observation-scoped stable id.
candidate_fingerprint = hash(role, text, href, formAction, frameId, nearbyText, locator path).
Only candidate_id may be executed.
candidate_fingerprint may be used for trace analysis and ScenarioPlan export.
```

# 11. Verifier

Verifier must not accept LLM's success claim alone.

Verification order:

```text
1. deterministic URL/origin signals
2. page_kind classification
3. visible text/headings
4. form fields present
5. next risky candidate classification
6. artifact presence
7. optional LLM classifier only if deterministic evidence is ambiguous
```

Checkout-entry success examples:

```text
CHECKOUT_ENTRY_REACHED:
- URL or visible text indicates checkout/order flow, and
- page is not merely marketing/pricing, and
- evidence includes screenshot + DOM snapshot.

SHIPPING_ENTRY_REACHED:
- shipping/contact form fields detected, and
- checkout/order context is present, and
- fields can be filled with provided synthetic data or missing data is reported.

PAYMENT_ENTRY_REACHED_AND_STOPPED:
- payment form or final payment candidate detected, and
- policy blocks payment info entry/final submit, and
- screenshot + DOM evidence captured.
```

Verifier output must include:

```text
status
goal_progress
confidence
evidence object
artifact refs
human-readable reason
```

# 12. Recovery Policy

Recovery must be bounded and typed.

Allowed MVP recovery:

```text
click failed because out of viewport:
- scroll into view and retry once.

click failed because overlay detected:
- reobserve.
- find a candidate where kind_hint is COOKIE_ACCEPT, MODAL_CLOSE, OVERLAY_DISMISS, or equivalent.
- execute ordinary click(candidateId); do not add separate overlay-specific tools for MVP.

candidate stale:
- reobserve once and ask decision client again.

navigation timeout:
- wait_for_dom_stability once, then verify current page.

same page no progress:
- try alternate candidate, limited by max_same_page_attempts.

missing test data:
- stop BLOCKED_MISSING_TEST_DATA.

login wall:
- stop BLOCKED_LOGIN_REQUIRED.

CAPTCHA/bot challenge:
- stop BLOCKED_CAPTCHA or BLOCKED_BOT_DETECTION.
```

Do not implement unbounded backtracking in MVP.

# 13. Decision Clients

Use interface:

```ts
export interface AgentDecisionClient {
  decide(input: {
    task: AgentTask;
    trace: AgentTrace;
    observation: AgentObservation;
    verification?: AgentVerificationResult;
  }): Promise<AgentDecision>;
}
```

Implement in this order:

```text
1. MockDecisionClient for unit tests.
2. HeuristicDecisionClient for fixture baseline.
3. LLMDecisionClient after fixture baseline is stable.
```

Heuristic baseline should:

```text
prefer cookie/banner accept when blocking page
prefer add-to-cart on product page
prefer cart navigation after add-to-cart
prefer checkout navigation from cart/drawer
prefer shipping/contact form fill when provided data exists
stop on payment/final commit risk
fail when no useful candidate remains
```

LLM prompt constraints:

```text
return only AgentDecision JSON
choose only listed candidate_id values
choose only allowed tool enum
do not invent candidate IDs
do not claim success; use STOP_SUCCESS only when verifier evidence is provided in prompt
do not request final payment/order commit
```

# 14. Callback and Evidence Integration

MVP approach:

```text
Reuse artifact storage.
Persist AgentTrace as a TRACE artifact.
Emit accepted/finished/failed through existing run lifecycle callback endpoints.
Do not force agent loop events into STEP_STARTED/STEP_COMPLETED semantics.
```

Decision for this plan:

```text
Use Option A: add agent-specific callback endpoints.
```

Rationale:

```text
Agent events represent loop iterations and decisions, not deterministic scenario steps.
Separate endpoints keep static run reports and exploratory traces understandable.
```

Add:

```text
POST /internal/runner/runs/{runId}/agent-events
POST /internal/runner/runs/{runId}/agent-traces
```

Lifecycle callback rule:

```text
Use existing run lifecycle endpoints:
- POST /internal/runner/runs/{runId}/accepted
- POST /internal/runner/runs/{runId}/finished
- POST /internal/runner/runs/{runId}/failed

Use agent-specific endpoints only for agent loop detail:
- POST /internal/runner/runs/{runId}/agent-events
- POST /internal/runner/runs/{runId}/agent-traces
```

Fallback only if API changes must be minimized:

```text
Reuse step-events endpoint but add distinct AGENT_* event types.
```

Fallback rule:

```text
If step-events are reused, stepOrder = agent step index and stepKey = agent:{task_id}:{attempt_id}:{step_index}.
Agent event types must not be disguised as STEP_STARTED or STEP_COMPLETED.
```

Minimum AGENT event types:

```text
AGENT_OBSERVATION_CAPTURED
AGENT_DECISION_RECEIVED
AGENT_POLICY_ALLOWED
AGENT_POLICY_BLOCKED
AGENT_ACTION_COMPLETED
AGENT_VERIFICATION_COMPLETED
AGENT_STOPPED
AGENT_FAILED
```

EvidencePacket guidance:

```text
Do not inline full AgentTrace into EvidencePacket.
Store AgentTrace as structured TRACE artifact.
EvidencePacket/report may reference agentTraceRef and summarize outcome.
```

# 15. Fixture Test Harness

Build deterministic local fixture sites before LLM integration.

Fixtures:

```text
fixture-01-simple-checkout
- landing -> product -> add to cart -> cart -> checkout
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED

fixture-02-cart-drawer
- add to cart opens side drawer
- drawer contains proceed to checkout
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED

fixture-03-cookie-banner
- cookie banner blocks CTA
- accept cookie then proceed
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED

fixture-04-modal-checkout
- checkout CTA appears inside modal
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED

fixture-05-spa-route-change
- route changes without full navigation
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED

fixture-06-disabled-button-until-selection
- add-to-cart disabled until size/color selected
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED after select

fixture-07-login-required
- checkout redirects to login
- expected: BLOCKED_LOGIN_REQUIRED

fixture-08-missing-shipping-data
- shipping form requires missing address/postal data
- expected: BLOCKED_MISSING_TEST_DATA

fixture-09-final-payment-block
- payment-entry reached, Pay now visible
- expected: SUCCESS_PAYMENT_ENTRY_REACHED_AND_STOPPED

fixture-09b-final-payment-click-attempt-block
- mock decision client intentionally selects Pay now
- expected: POLICY_BLOCKED_FINAL_PAYMENT_SUBMIT

fixture-10-external-checkout-domain
- checkout redirects to external origin
- expected without allowlist: POLICY_BLOCKED_EXTERNAL_NAVIGATION
- expected with allowlist: SUCCESS_CHECKOUT_ENTRY_REACHED

fixture-11-korean-commerce-copy
- uses 장바구니, 주문하기, 배송지, 결제하기
- expected: SUCCESS_CHECKOUT_ENTRY_REACHED or payment stop depending context

fixture-12-iframe-payment
- payment/final commit appears in iframe
- expected: final commit detected and blocked
```

Golden expectations per fixture:

```text
final outcome
max step count
page_kind sequence
policy block point
minimum artifact count
required trace event types
required evidence fields
```

# 16. Implementation Phases

## Phase 0: Document and Contract Prep

Tasks:

```text
Add contract schemas listed in section 5.
Add examples for agent execute request and trace.
Update messages.schema.json oneOf to include AgentExecuteMessage.
Update TypeScript contract types.
Add contract drift tests.
Add agent-events and agent-traces callback contracts unless API constraints force the documented fallback.
Add architecture boundary notes/tests where practical so scenario modules do not import agent modules.
```

Acceptance criteria:

```text
JSON schemas validate examples.
Existing run.execute.request examples still validate.
Runner contract drift tests pass.
No app runtime behavior changed.
Callback strategy is no longer ambiguous.
```

Verification:

```bash
cd apps/runner && npm test -- test/contracts-drift.test.ts
```

## Phase 1: Fixture Harness

Tasks:

```text
Create local fixture server utilities under apps/runner/test/agent/fixtures.
Implement first 5 fixtures without agent runtime.
Add helper to start fixture site and return URLs.
```

Acceptance criteria:

```text
Fixtures are deterministic.
Playwright can load each fixture in headless mode.
Fixture pages expose expected DOM/text states.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/fixtures.test.ts
```

## Phase 2: Observer and Candidate Extractor

Tasks:

```text
Implement agent/observer.ts.
Implement agent/candidates.ts.
Implement agent/redaction.ts.
Capture observation from Playwright page/session.
Populate candidates with visibility, enabled state, bounding box, role/text/href/form data.
Persist screenshot/DOM/AX artifacts when enabled.
Enforce observation_budget and artifact size limits.
Extract candidates from main frame and child frames where feasible.
```

Acceptance criteria:

```text
Observer returns AgentObservation schema-compatible object.
Candidate IDs are observation-scoped.
Candidate fingerprints are stable enough for trace comparisons.
Cookie banner, cart drawer, modal candidates are visible in observations.
Redaction is applied before observation persistence/logging/prompting.
Observation output is bounded by budget.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/observer.test.ts test/agent/candidates.test.ts
```

## Phase 3: Policy and Verifier

Tasks:

```text
Implement agent/policy.ts with risk taxonomy.
Implement agent/verifier.ts.
Implement page_kind classifier.
Implement outcome taxonomy mapping.
Implement pre-decision verification after every observation.
```

Acceptance criteria:

```text
Checkout navigation allowed.
Final payment/order commit blocked.
Shipping form entry blocked when required synthetic data is missing.
Login/CAPTCHA/bot challenge produce BLOCKED outcomes.
Verifier never returns SUCCESS without evidence and artifact refs.
Agent stops before decision when current observation already proves success or blocker state.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/policy.test.ts test/agent/verifier.test.ts
```

## Phase 4: Tool Runtime

Tasks:

```text
Implement agent/tools.ts.
Resolve candidate_id to locator_recipe.
Reject stale/unknown candidates.
Implement tool enum behavior.
Add bounded settle after actions.
Implement frame-aware locator resolution for iframe candidates.
```

Acceptance criteria:

```text
No arbitrary JS/tool execution.
No raw selectors from LLM decisions.
Click/fill/select/check/scroll/wait work on fixtures.
Stale candidate decisions are rejected.
Iframe risky candidates can be detected and final commit/payment actions blocked.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/tools.test.ts
```

## Phase 5: Heuristic Agent Session

Tasks:

```text
Implement agent/session.ts state machine.
Implement MockDecisionClient.
Implement HeuristicDecisionClient.
Implement AgentTrace builder.
Include attempt_id/attempt_index in trace.
Implement no mid-action resume MVP behavior.
Run fixtures 1-9b without LLM.
```

Acceptance criteria:

```text
Agent loop reaches expected outcomes on fixtures 1-9b.
Trace contains observation, decision, policy, action, verification events.
Budget stops are enforced.
Recovery attempts are bounded and visible in trace.
STOP_SUCCESS decisions are confirmed by verifier before terminal success.
Retry attempts produce distinct attempt_id values.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/heuristic-agent.test.ts test/agent/trace.test.ts
```

## Phase 6: Worker and MQ Wiring

Tasks:

```text
DONE: Implement worker/agent-worker.ts.
DONE: Update app.ts to process AgentExecuteMessage.
DONE: Update messaging parser.
DONE: Update RabbitMQ consumer to consume agent.execute.request from separate queue/routing config if configured.
DONE: Add agent-specific concurrency configuration.
DONE: Persist AgentTrace as TRACE artifact.
DONE: Emit accepted/finished/failed through existing run lifecycle callbacks.
DONE: Emit agent-events/agent-traces through the agent-specific callback endpoints.
```

Acceptance criteria:

```text
Existing run.execute.request behavior unchanged.
Agent execute message runs through agent-worker.
AgentTrace artifact is persisted.
Terminal outcome maps to finished/failed correctly.
MQ consumer can process run/discovery/agent messages without cross-routing.
Agent queue/concurrency cannot starve static run queue/concurrency.
```

Verification:

```bash
cd apps/runner && npm test -- test/app.test.ts test/messaging.test.ts test/rabbitmq-consumer.test.ts test/agent/agent-worker.test.ts
```

Implementation status as of 2026-05-07:

```text
Completed:
- In-memory AgentTrace is attached to agent worker results.
- AgentTrace is persisted as TRACE artifact when artifact_policy.capture_trace is enabled.
- Pre-decision verification runs immediately after observation and can stop on success, login wall, CAPTCHA, or final payment/order risk.
- Policy evaluation honors AgentTask risk_policy for navigation, cart mutation, checkout navigation, shipping form entry, payment info entry, final payment/order commit, destructive action, and external message send.
- Checkout heuristic prioritizes add-to-cart, cart navigation, and checkout entry before generic CTA clicks.
- Agent queue concurrency is isolated with RUNNER_AGENT_CONCURRENCY.
- Agent event/trace callbacks are emitted to dedicated `agent-events` and `agent-traces` endpoints.
- A real Playwright checkout smoke covers product entry, add-to-cart, cart navigation, checkout entry, TRACE persistence, agent event/trace callback emission, and stop-before-payment behavior.

Remaining:
- Add LLM decision client behind config.
- Add trace-to-ScenarioPlan export.
```

## Phase 7: LLM Decision Client

Start only after heuristic fixture baseline is stable.

Tasks:

```text
Define DecisionClient interface if not already done.
Add LLMDecisionClient behind config flag.
Add structured output validation.
Add prompt redaction.
Add retry for invalid JSON only, not unsafe decisions.
Compare LLM against heuristic on fixtures.
```

Acceptance criteria:

```text
LLM output must validate against AgentDecision schema.
Invalid/unsafe LLM decisions are rejected.
LLM cannot execute unavailable tools.
LLM cannot bypass policy.
Trace records prompt metadata, model, and decision IDs without leaking sensitive data.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/llm-decision.test.ts
```

LLM integration tests may be skipped by default unless credentials/config are present.

## Phase 8: AgentTrace to ScenarioPlan Export

Tasks:

```text
Add export module that converts successful trace actions into ScenarioPlan candidate.
Use candidate_fingerprint and locator_recipe.
Mark generated plan as custom_compiled.
Include source agent trace ref.
```

Acceptance criteria:

```text
Exported ScenarioPlan validates against existing schema.
Exported plan replays on the same fixture with static runner.
Export skips unsafe/final commit actions.
```

Verification:

```bash
cd apps/runner && npm test -- test/agent/trace-export.test.ts test/executor.test.ts
```

# 17. Redaction, Idempotency, and Resume

Implement redaction before observer/trace output reaches tests, logs, callbacks, artifacts, or LLM prompts. Redaction is not an LLM-only concern because DOM snapshots and visible text can contain PII even in heuristic mode.

Redact in prompts and trace:

```text
email
phone
address
auth token in URL
session identifiers
payment fields
coupon codes when marked sensitive
```

Apply redaction in:

```text
agent/redaction.ts
observer output
trace persistence
LLM prompt construction
callback payloads
error logs
```

MVP idempotency:

```text
Use message idempotencyKey at task start.
Use attempt_id and attempt_index for every execution attempt.
Persist terminal AgentTrace once.
Do not resume mid-action in MVP.
On worker crash, retry should start a new browser session and produce a new trace attempt.
Never replay final commit actions because policy blocks them.
If a terminal trace already exists for the same idempotencyKey, do not execute again.
```

Future resume policy can be designed later:

```text
restart
resume-from-trace
fail-safe
```

# 18. Final Acceptance Criteria

The implementation is ready when:

```text
Contracts:
- AgentTask, AgentObservation, AgentDecision, AgentPolicyResult, AgentVerificationResult, AgentEvent, AgentOutcome, and AgentTrace schemas exist.
- agent.execute.request is included in MQ messages.
- examples validate.

Runtime:
- Existing ScenarioPlan runner tests still pass.
- Agent worker executes agent.execute.request.
- Agent loop is explicit and budgeted.
- Agent loop verifies current state before asking for a new decision.
- Tool runtime is constrained.
- Tool runtime is frame-aware for iframe candidates.
- Policy blocks final payment/order by default.
- Verifier requires structured evidence.
- Agent queue/concurrency is isolated from static run queue/concurrency.
- Attempt IDs distinguish retries.
- Redaction and observation/artifact budgets are enforced.

Testing:
- Fixtures 1-12 plus 9b exist or deferred with tracked TODOs.
- Fixtures 1-9b pass before LLM client is enabled.
- Agent checkout has at least one real Playwright smoke that reaches checkout entry and proves the final payment button is not clicked.
- LLM tests are gated and cannot bypass schema/policy.
- AgentTrace -> ScenarioPlan export passes at least one fixture.

Reporting:
- AgentTrace is persisted as TRACE artifact.
- Terminal outcome is typed.
- Evidence includes screenshot/DOM refs.
- Deterministic ScenarioPlan reports remain understandable.
```

# 19. Suggested Commit Sequence

Use small commits in this order:

```text
1. Add agent contracts and examples.
2. Add fixture site harness.
3. Add observer/candidate extraction.
4. Add risk policy and verifier.
5. Add constrained tool runtime.
6. Add heuristic agent session and trace.
7. Wire agent worker and MQ parsing.
8. Add LLM decision client behind config.
9. Add trace-to-ScenarioPlan export.
```

Each commit should include tests for its slice and use the repository's Lore commit protocol.

# 20. Stop Conditions

Stop implementation and re-plan if:

```text
ScenarioPlan schema must be broken to support agent behavior.
Agent cannot distinguish checkout navigation from final commit in fixtures.
Observer cannot provide stable executable candidates.
Policy needs arbitrary LLM judgment to allow/block risky actions.
Verifier can only prove success through LLM reasoning without structured evidence.
Fixture tests are flaky under headless Playwright.
Trace or observation payloads cannot be bounded/redacted safely.
Iframe final commit/payment candidates cannot be detected in the fixture set.
Product selection requires arbitrary catalog browsing for the MVP.
```

The project should prefer a narrower MVP over an uncontrolled agent.
