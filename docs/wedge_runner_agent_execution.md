---
title: Wedge Runner Agent Execution Design
document_type: runner-agent-execution-design
status: current-draft
last_updated: 2026-05-06
intended_use:
  - implementation_reference
  - ai_tasking
  - product_alignment
related_documents:
  - 01_architecture_and_project_structure.md
  - 03_api_reference.md
  - 04_domain_payload_contracts.md
  - wedge_runner_architecture.md
  - AI_CONTEXT_GUIDE.md
  - ../apps/runner/README.md
  - ../packages/contracts/types/runner.ts
  - ../packages/contracts/mq/messages.schema.json
  - ../packages/contracts/internal/runner-callback.schema.json
---

# 1. 목적

이 문서는 Runner를 "사용자가 작성한 완성 시나리오를 실행하는 엔진"에서 "사용자 목표를 받아 화면을 관찰하고 다음 행동을 선택하는 UX Agent"로 전환하기 위한 구현 기준을 정의한다.

현재 구현은 `ScenarioPlan.steps[]`를 순서대로 실행하는 deterministic executor다. 이 방식은 재현성은 좋지만, Wedge의 핵심 사용자가 UX 테스트 시나리오를 직접 설계할 수 있다고 가정한다. 이 가정은 제품 가치 제안과 맞지 않는다.

목표 사용자 관점의 입력은 다음 수준이어야 한다.

```text
서비스 URL
서비스/페이지의 대략적인 목적
중요하게 확인하고 싶은 목표 또는 기본 UX 점검 요청
```

사용자에게 요구하지 말아야 할 입력은 다음이다.

```text
클릭 순서
selector
step list
완성된 ScenarioPlan
정교한 성공 조건 DSL
```

따라서 target architecture는 다음과 같다.

```text
UserRunGoal(startUrl, goal, constraints)
→ API server creates an AgentTask
→ agent.execute.request
→ Runner Agent observe/decide/act/verify loop
→ checkpoints/artifacts/turn trace
→ UX 분석용 evidence
→ replay 가능한 ScenarioPlan 또는 실행 경로는 산출물로 저장
```

# 2. 제품 원칙

## 2.1 시나리오는 사용자 입력이 아니다

`ScenarioPlan`은 계속 필요한 내부 contract지만, 사용자-facing 입력의 중심이 되어서는 안 된다.

새 원칙:

```text
사용자 입력 = URL + 목표 + 선택 제약
Runner 내부 = Agent loop + action tools + safety policy
실행 산출물 = evidence + turn trace + optional generated ScenarioPlan
```

이 원칙을 어기면 사용자는 "내가 시나리오를 짤 줄 알면 왜 Wedge를 쓰지?"라고 느낄 수 있다.

## 2.2 Runner Agent의 기본 UX

사용자-facing 표현은 다음을 선호한다.

| 내부 용어 | 사용자-facing 표현 |
| --- | --- |
| Agent execution | AI UX 점검 |
| ScenarioPlan | 자동 탐색 경로 / 재점검 경로 |
| ScenarioStep | AI가 수행한 행동 |
| Turn trace | 탐색 기록 |
| Success criteria | 목표 달성 여부 |
| Replay | 다시 점검하기 |

사용자에게 `scripted`, `scenario`, `selector`, `step` 같은 구현 용어를 기본 노출하지 않는다.

## 2.3 Agent가 시나리오를 생성한다

Agent 실행이 성공하면, 그 실행 trace에서 replay 가능한 경로를 생성할 수 있다. 이 경로는 다음 실행의 힌트 또는 빠른 재점검용이다.

```text
첫 실행: goal 기반 agent 탐색
다음 실행: 저장된 경로 먼저 시도
경로 실패: agent 탐색으로 복구
```

# 3. 현재 코드 기준 경로 분리

현재 Runner는 두 실행 경로를 분리한다.

```text
agent.execute.request
→ AgentExecuteMessage validation
→ AgentTask(start_url, goal_type, budget, risk_policy)
→ agent worker
→ observe/decide/act/verify loop
→ agent-events / agent-traces / TRACE artifact
```

```text
run.execute.request
→ RunExecuteMessage validation
→ payload.scenarioPlan 필수 검증
→ worker
→ executeScenario(plan.steps)
```

결정:

1. `agent.execute.request`를 공식 Runner Agent 실행 경로로 둔다.
2. `run.execute.request`는 기존 `ScenarioPlan` 기반 scripted/replay 실행 전용으로 유지한다.
3. 사용자-facing API/UI는 `agent.execute`나 `run.execute`라는 MQ 용어를 노출하지 않는다. API 서버가 사용자의 실행 의도에 따라 내부 MQ message를 선택한다.
4. Agent 실행이 성공하면 replay 가능한 `ScenarioPlan` 후보를 산출물로 저장할 수 있지만, 그 후보의 재실행은 `run.execute.request`가 담당한다.

이 분리를 유지하는 이유는 다음이다.

- Agent job은 observe/decide loop, LLM fallback, trace, idempotency, risk policy 때문에 static replay보다 무겁다.
- 별도 queue/concurrency 설정으로 agent job이 deterministic run queue를 굶기지 않게 해야 한다.
- 기존 `run.execute.request`의 `scenarioPlan` 필수 계약과 회귀 테스트를 깨지 않는다.
- callback/event 의미가 scripted step event와 exploratory agent turn event로 섞이지 않는다.

반대로 이미 재사용 가능한 자산도 있다.

- `BrowserSession.execute(action, step)`는 action tool 역할을 할 수 있다.
- `BrowserSession.snapshot()`은 observation source 역할을 할 수 있다.
- `interactiveComponents`는 CTA/button/link 후보 추출을 이미 제공한다.
- `executeScenarioStep()`은 action event, settle, checkpoint, artifact emission을 재사용할 수 있다.
- callback/storage/outbox adapter는 agent mode에서도 유지 가능하다.

# 4. Target execution model

## 4.1 실행 경로

Runner는 장기적으로 두 실행 경로를 지원한다. 이 둘은 하나의 `RunExecutionMode` field로 합치지 않고 MQ message type으로 분리한다.

```text
agent.execute.request = 기본 사용자-facing AI UX 점검 경로
run.execute.request   = 저장된 ScenarioPlan scripted/replay 경로
```

- `agent.execute.request`: `start_url`, `goal_type`, optional `goal`, budget, risk policy만으로 observe/decide/act/verify loop를 수행한다.
- `run.execute.request`: 기존 `ScenarioPlan.steps[]`를 그대로 실행한다. 내부 replay, regression, 운영 재점검에 사용한다.

사용자-facing 기본값은 항상 Agent 실행이다. `scripted` replay는 고급/내부 기능이며, API 서버가 내부적으로 `run.execute.request`를 발행할 때만 사용한다.

## 4.2 Agent loop

Agent mode의 핵심 loop:

```text
initialize runtime plan/session
→ turn 1 observe
→ decide next action
→ execute action via existing ScenarioStep executor
→ settle/capture/checkpoint
→ verify goal
→ update state
→ repeat until success/failure/maxTurns
```

의사 코드:

```ts
for (let turn = 1; turn <= maxTurns; turn += 1) {
  const observation = await observePage(session, state);
  const decision = await planner.decide({ goal, state, observation, policy });
  const step = agentDecisionToScenarioStep(decision, turn);

  const result = await executeScenarioStep({
    runId,
    stepOrder: turn,
    step,
    plan: runtimePlan,
    session,
    callbackClient,
    capturePipeline,
    artifactStore
  });

  const verification = await verifier.verify({ goal, state, observation, decision, result });
  state = updateAgentState(state, { observation, decision, result, verification });

  if (verification.satisfied) break;
}
```

## 4.3 Runtime plan

현재 `BrowserSession`이 `ScenarioPlan`을 요구하므로 agent mode에서도 내부 `runtimePlan`은 필요하다. 단, 이 plan은 사용자가 작성한 시나리오가 아니다.

`runtimePlan`의 역할:

- viewport/locale/timezone/auth/safety를 browser adapter에 전달한다.
- start URL과 goal을 safety policy에 제공한다.
- generated step을 실행할 때 기존 `ScenarioStep` shape를 맞춘다.

`runtimePlan.steps`는 비워두거나 최소 bootstrap step만 둘 수 있게 contract 변경이 필요하다. contract 변경 전 MVP에서는 내부에서 synthetic `goto` step 1개를 가진 plan을 만들 수 있다.

# 5. Contract change plan

계약은 항상 `packages/contracts`를 먼저 바꾼다. Runner Agent의 공식 MQ 경로는 `agent.execute.request`다. `run.execute.request`는 scripted/replay용 `ScenarioPlan` 실행 계약으로 유지한다.

## 5.1 `AgentExecuteMessage.payload`

Agent 실행 입력은 `AgentTask` 하나로 고정한다. 사용자-facing API는 URL/goal/constraints를 받아 API 서버 내부에서 이 task를 만든다.

```ts
export interface AgentExecuteMessage {
  messageType: "agent.execute.request";
  payload: {
    agentTask: AgentTask;
  };
}

export interface AgentTask {
  schema_version: "0.1";
  task_id: string;
  attempt_id: string;
  attempt_index: number;
  run_id: string;
  project_id: string;
  goal_type: "CHECKOUT_ENTRY_VERIFICATION";
  goal?: string;
  start_url: string;
  environment: ScenarioPlan["environment"];
  budget: AgentBudget;
  allowed_navigation: AgentAllowedNavigation;
  risk_policy: AgentRiskPolicy;
  observation_budget?: AgentObservationBudget;
  product_selection_policy?: AgentProductSelectionPolicy;
  test_data?: AgentTestData;
  artifact_policy?: AgentArtifactPolicy;
}
```

Validation rule:

```text
agent.execute.request → agentTask required
AgentTask.goal_type initially supports CHECKOUT_ENTRY_VERIFICATION
AgentTask.start_url, environment, budget, allowed_navigation, risk_policy required
LLM/provider config does not belong in the message; it stays Runner runtime config
```

## 5.2 `RunExecuteMessage.payload`

`run.execute.request`는 agent mode와 합치지 않는다. 이 message는 replay/scripted 실행 전용이다.

현재 유지되는 필수 필드:

```ts
scenarioTemplateVersionId: string;
scenarioPlan: ScenarioPlan;
```

Validation rule:

```text
run.execute.request → scenarioPlan required
run.execute.request → scenarioTemplateVersionId required
run.execute.request → envelope와 scenarioPlan consistency validation 유지
scenarioPlan 없는 사용자 목표 실행은 run.execute가 아니라 agent.execute로 보낸다
```

## 5.3 Agent turn event contract

Agent mode는 turn 개념이 있어야 실행이 agent처럼 설명된다. 현재 공식 callback surface는 `agent-events`와 `agent-traces`다.

현재 MVP event type:

```ts
type AgentCallbackEventType =
  | "PRE_DECISION_VERIFIED"
  | "DECISION_MADE"
  | "POLICY_CHECKED"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED"
  | "GOAL_VERIFIED"
  | "TRACE_PERSISTED";
```

장기적으로 richer `AGENT_*` event taxonomy가 필요하면 `packages/contracts/internal/runner-callback.schema.json`과 `packages/contracts/schemas/agent-event.schema.json`을 먼저 확장한다.

## 5.4 Agent trace artifact

Agent 실행 결과는 분석과 replay에 필요하다. TRACE artifact에는 LLM chain-of-thought를 저장하지 않고, observation summary, selected action, decision reason, policy result, verification result 같은 설명 가능한 metadata만 저장한다.

현재 MVP trace shape:

```ts
export interface AgentTrace {
  schema_version: "0.1";
  task_id: string;
  attempt_id: string;
  run_id: string;
  turns: AgentTurnTrace[];
  outcome: {
    status: "RUNNING" | "SUCCESS" | "POLICY_BLOCKED" | "BLOCKED" | "FAILED" | "EXHAUSTED";
    reason: string;
  };
}
```

주의:

- LLM chain-of-thought를 저장하지 않는다.
- 저장 전 redaction을 적용한다.
- 성공 trace에서 생성된 replay 후보는 `ScenarioPlan` artifact로 저장하고, 재실행은 `run.execute.request`로 수행한다.

# 6. Runner module changes

## 6.1 새 디렉터리

추가 대상:

```text
apps/runner/src/agent/
├─ index.ts
├─ controller.ts
├─ observation.ts
├─ planner.ts
├─ verifier.ts
├─ state.ts
├─ runtime-plan.ts
└─ trace.ts
```

책임:

- `controller.ts`: turn loop 소유
- `observation.ts`: `BrowserSession.snapshot()`을 agent observation으로 축약
- `planner.ts`: 다음 action 선택. 처음은 rule-based, 나중에 LLM planner 추가
- `verifier.ts`: 목표 달성 판단
- `state.ts`: visited actions, failed selectors, scroll count, clicked candidates 관리
- `runtime-plan.ts`: agent request에서 내부 `ScenarioPlan` 생성
- `trace.ts`: replay/generation용 turn trace 생성

## 6.2 `messaging/index.ts`

변경/유지:

- `parseAgentExecuteMessage()`가 `agent.execute.request`와 `AgentTask`를 검증한다.
- `parseRunExecuteMessage()`는 기존대로 `scenarioPlan` 필수와 consistency validation을 유지한다.
- `run.execute.request`에 `executionMode`를 추가하지 않는다. Agent 실행은 별도 `agent.execute.request`로 보낸다.

## 6.3 `worker/index.ts` and `worker/agent-worker.ts`

분리된 dispatch:

```ts
if (messageType === "agent.execute.request") {
  return agentWorker.handleMessage(parseAgentExecuteMessage(rawMessage));
}

if (messageType === "run.execute.request") {
  return runWorker.handleMessage(parseRunExecuteMessage(rawMessage));
}
```

Worker의 책임은 계속 lifecycle orchestration에만 둔다. Agent 판단 로직은 `worker/index.ts`가 아니라 `apps/runner/src/agent/*`와 `worker/agent-worker.ts` 경계 안에 둔다.

## 6.4 `browser/playwright/index.ts`

기존 interface는 유지하되 observation 품질을 높인다.

우선 재사용:

```ts
snapshot().interactiveComponents
snapshot().consoleErrors
snapshot().networkErrors
snapshot().visitedUrls
snapshot().title
snapshot().finalUrl
```

추가 후보:

- input fields observation
- visible heading/text summary
- form candidates
- disabled/loading state
- modal/dialog presence
- current viewport coverage

단, Playwright `Page`를 agent/controller로 직접 노출하지 않는다.

## 6.5 `scenario/executor/step-executor.ts`

MVP에서는 재사용한다.

Agent decision을 synthetic `ScenarioStep`으로 변환해서 기존 executor를 통과시킨다.

```ts
function agentDecisionToScenarioStep(decision, turn): ScenarioStep {
  return {
    step_id: `agent_turn_${turn}`,
    stage: inferStage(decision),
    description: decision.description,
    action: decision.action,
    settle_strategy: decision.settleStrategy,
    checkpoint: true
  };
}
```

# 7. MVP planner

처음부터 LLM을 붙이지 않는다. Runner Agent 구조를 먼저 만들고, planner seam을 고정한다.

## 7.1 Rule-based CTA planner

목표:

```text
URL만 입력해도 주요 CTA를 찾아 클릭하고, 다음 화면으로 이동했는지 확인한다.
```

Decision order:

1. 아직 시작 URL에 가지 않았다면 `goto(startUrl)`
2. 현재 화면에서 `is_primary_like` 또는 `is_cta_candidate` 후보를 찾는다.
3. 이미 클릭한 후보는 제외한다.
4. 가장 높은 우선순위 후보를 `click`한다.
5. 후보가 없고 scroll budget이 남아 있으면 `scroll`한다.
6. console/network hard error가 많으면 issue signal을 남긴다.
7. maxTurns에 도달하면 `MAX_TURNS`로 종료한다.

Target 생성:

```ts
{
  selector: component.selector,
  role: component.role ?? undefined,
  text: component.text || undefined
}
```

## 7.2 Goal verifier MVP

처음 verifier는 보수적으로 둔다.

성공 후보:

- URL이 변경되었고 signup/contact/checkout/pricing 등 목표 관련 keyword를 포함한다.
- 클릭 이후 primary CTA 후보가 다른 화면으로 이동했다.
- visible text/title에 goal keyword 또는 flow keyword가 나타난다.
- `stopBeforeRealPayment` safety 조건에 의해 결제 직전까지 도달했다.

실패 후보:

- 클릭 가능한 후보가 없다.
- 같은 URL/같은 후보만 반복한다.
- external navigation이 safety policy에 의해 차단된다.
- destructive/payment action이 차단된다.
- maxTurns 초과.

Verifier는 100% 정답 판정기가 아니라 analysis evidence를 만들기 위한 실행 stop policy다.

# 8. LLM planner 확장 위치

LLM planner는 MVP 이후 추가한다.

Interface:

```ts
export interface AgentPlanner {
  decide(input: AgentDecisionInput): Promise<AgentDecision>;
}
```

구현체:

```text
RuleBasedPlanner       기본 deterministic planner
LlmPlanner             observation 요약 기반 action 선택
ReplayHintPlanner      과거 successful trace를 먼저 시도
TestPlanner            테스트용 고정 decision sequence
```

LLM planner 입력은 raw DOM 전체가 아니라 축약된 observation이어야 한다.

LLM planner 출력은 반드시 contract action으로 제한한다.

```ts
{
  action: ScenarioAction;
  settleStrategy: SettleStrategy;
  reason: string;
  confidence: number;
}
```

금지:

- LLM이 Playwright code를 직접 생성
- LLM이 arbitrary JS를 실행
- LLM chain-of-thought 저장
- safety policy 우회

# 9. Safety policy

기존 `scenario/policy.ts`를 agent mode에서도 사용한다.

기본값:

```text
allow_external_navigation = false
allow_payment_commit = false
allow_destructive_action = false
use_synthetic_inputs = true
stop_before_real_payment = true
```

Agent mode에서 더 중요한 규칙:

- form submit 전 synthetic/test input만 사용한다.
- 결제/삭제/초대/발송/게시 등 irreversible action은 클릭하지 않는다.
- external domain 이동은 기본 차단한다.
- 로그인/인증이 필요한 경우 "blocked by auth"로 기록하고 무리하게 우회하지 않는다.
- action은 반드시 `ScenarioAction` enum으로 표현한다.

# 10. Evidence and reporting expectations

Agent mode는 UX 리포트를 위한 evidence를 만들어야 한다.

각 turn에서 최소 수집:

```text
observation summary
selected candidate/action
decision reason
settle result
final URL/title
screenshot/DOM snapshot refs
console/network errors
verification result
```

사용자-facing 리포트는 다음 구조를 지원해야 한다.

```text
AI가 시도한 일
막힌 지점
근거 화면/행동
UX 문제 해석
개선 제안
```

따라서 agent trace는 "내부 디버그 로그"가 아니라 Analyzer가 사용할 수 있는 evidence source여야 한다.

# 11. Implementation sequence

## Phase 1 — Contract-first agent execute skeleton

변경:

1. `packages/contracts/types/runner.ts`
   - `AgentTask`, `AgentExecuteMessage` 추가
   - `RunExecuteMessage`는 scripted/replay 전용으로 유지
2. `packages/contracts/mq/messages.schema.json`
   - `AgentExecuteMessage`를 `oneOf`에 추가
   - `run.execute.request`의 `scenarioPlan` 필수 규칙 유지
3. `packages/contracts/schemas/agent-*.schema.json`
   - AgentTask/Observation/Decision/PolicyResult/VerificationResult/Event/Outcome/Trace contract 추가
4. `apps/runner/src/messaging/index.ts`
   - `parseAgentExecuteMessage()` 추가
5. 테스트
   - `agent.execute.request` parse 성공
   - `run.execute.request`에서 `scenarioPlan` 누락 실패 유지
   - scripted consistency validation 유지

## Phase 2 — Agent controller MVP

변경:

1. `apps/runner/src/agent/*` 추가
2. `worker/index.ts`에서 mode 분기
3. agent runtime plan 생성
4. rule-based CTA planner
5. goal verifier MVP
6. 테스트
   - simulated browser에서 `goto → click/scroll` decision sequence 검증
   - maxTurns 종료 검증
   - worker finished/failed policy 유지

## Phase 3 — Agent turn evidence

변경:

1. 기존 `StepEvent` payload에 agent metadata 추가 또는 `AgentTurnEvent` contract 추가
2. checkpoint observations에 selected candidate/decision reason 추가
3. trace artifact 저장
4. 테스트
   - turn마다 checkpoint/artifact callback 생성
   - trace artifact shape 검증

## Phase 4 — Generated replay path

변경:

1. successful agent trace에서 `ScenarioPlan` 생성
2. 다음 실행에서 replay hint로 사용
3. replay 실패 시 agent fallback
4. 테스트
   - generated plan schema validation
   - replay failure fallback

## Phase 5 — LLM planner optionalization

변경:

1. `AgentPlanner` interface에 LLM 구현 추가
2. provider timeout/fallback
3. prompt/version metadata를 trace에 저장
4. 테스트
   - invalid LLM action rejection
   - timeout 시 rule-based fallback

# 12. Testing strategy

필수 테스트 축:

```text
messaging validation
agent planner pure logic
agent verifier pure logic
agent controller loop with simulated session
worker mode dispatch
callback/checkpoint compatibility
real Playwright smoke for one URL fixture
```

현재 checkout-entry smoke 기준:

```text
apps/runner/test/playwright-mode.test.ts
-> [Agent Checkout Smoke]
-> product 진입
-> add-to-cart
-> cart 이동
-> checkout 진입
-> TRACE artifact / agent-events / agent-traces 확인
-> final payment button 미클릭 확인
-> login blocker / CAPTCHA blocker 실제 감지 확인
-> allowed checkout redirect origin 실제 이동 확인
```

실행 명령:

```bash
cd apps/runner
npm test
npx tsc --noEmit
```

문서-only 변경에서는 위 명령을 필수로 실행하지 않아도 된다. 단, contract/app 코드를 바꾸는 PR에서는 실행해야 한다.

# 13. Non-goals

이번 전환의 non-goal:

- 사용자가 full scenario builder를 작성하게 만드는 UI
- LLM에게 Playwright script를 생성하게 하는 구조
- MCP를 browser-control surface로 만드는 구조
- 첫 구현부터 완전 자율 multi-page UX auditor를 만드는 것
- Analyzer/Judge scoring까지 Runner 내부로 끌어오는 것

Runner Agent는 "실행과 evidence 수집"을 담당한다. 최종 UX 판단과 scoring은 Analyzer/Judge 경계와 결합하되 Runner 안으로 흡수하지 않는다.

# 14. Acceptance criteria

Runner Agent 전환이 최소 성공했다고 볼 수 있는 기준:

1. `agent.execute.request`가 `AgentTask`만으로 Agent Runtime을 실행한다.
2. 사용자-facing API는 URL과 goal만 받아 내부적으로 `agent.execute.request`를 발행할 수 있다.
3. Runner는 각 turn의 observation, decision, action result, verification evidence를 남긴다.
4. 기존 scripted `run.execute.request` + `ScenarioPlan` 실행은 깨지지 않는다.
5. safety default가 irreversible/payment/external 위험 행동을 차단한다.
6. 성공한 agent 실행은 replay/generation 가능한 trace와 optional `ScenarioPlan` 후보를 남긴다.
7. 실패해도 "어디서 왜 막혔는지"를 evidence로 설명할 수 있다.

# 15. 문서 상태

이 문서는 Runner Agent MVP 구현과 남은 확장 방향을 함께 기록하는 current draft다.

현재 구현된 작업:

- `packages/contracts`에 `AgentTask`, `AgentExecuteMessage`, `agent.execute.request` 방향 반영
- `apps/runner/src/agent` MVP controller/runtime-plan/rule-based planner/verifier 추가
- `worker/agent-worker.ts`와 MQ consumer에서 `agent.execute.request` dispatch 추가
- `run.execute.request`는 `ScenarioPlan` 필수 scripted/replay 경로로 유지
- agent event/trace callback, TRACE artifact, successful trace의 ScenarioPlan export MVP 추가
- LLM decision client를 config-gated optional path로 추가하고 heuristic fallback 유지

아직 수행하지 않은 작업:

- AgentObservation/Decision/Trace schema를 richer candidate/locator/iframe evidence 구조로 확장
- replay-hint planner 구현
- broader fixture suite와 heuristic-vs-LLM 비교 강화

구현을 시작할 때는 이 문서를 기준으로 contract-first 순서를 따른다.
