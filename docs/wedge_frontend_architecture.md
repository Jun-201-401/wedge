---
title: Wedge Frontend Architecture & Stack Decisions
document_type: frontend-architecture
status: current-draft
last_updated: 2026-04-19
intended_use:
  - implementation_reference
  - ai_tasking
  - team_share
related_documents:
  - 00_master_decisions.md
  - 01_architecture_and_project_structure.md
  - 03_api_reference.md
  - ../apps/web/README.md
---

# 1. 목적

이 문서는 `apps/web`의 frontend 기술 선택과 아키텍처 결정을 기록한다.

목표는 Wedge가 landing page에서 run monitoring, evidence viewing, report, project management, scenario building 같은 제품 화면으로 확장되어도 web app을 유지보수하기 쉽게 만드는 것이다.

# 2. 현재 frontend stack

`apps/web`은 현재 다음 stack을 사용한다.

- React 18
- React DOM 18
- TypeScript
- TSX
- Vite
- `@vitejs/plugin-react`
- `tsx`로 실행하는 `node:test`
- app/page/feature 경계가 명확한 plain CSS

현재 package script:

```bash
npm run dev
npm run build
npm test
npm run typecheck
```

# 3. 현재 결정 요약

## 3.1 당분간 Vite 기반 유지

결정: `apps/web`은 Vite + React + TypeScript를 사용한다.

근거:
- 현재 app은 client-heavy 구조이며 아직 server-side rendering이 필요하지 않다.
- 기존 landing sample도 Vite 기반이었다.
- product boundary가 형성되는 동안 Vite가 scaffold를 단순하게 유지한다.

보류:
- Next.js, Remix-style full-stack routing, server-side rendering 결정은 제품 요구사항이 필요해질 때까지 보류한다.

## 3.2 Page와 feature 경계 분리

결정: page orchestration과 feature 내부 구현을 분리한다.

현재 패턴:

```text
src/
├─ app/
├─ pages/
│  └─ landing/
├─ features/
│  └─ landing-vision/
├─ entities/
├─ shared/
├─ api/
└─ websocket/
```

규칙:
- `pages/*`는 user-facing screen과 route-level orchestration을 조합한다.
- `features/*`는 feature-specific component, hook, logic, style을 소유한다.
- `shared/*`는 반복 사용이 확인된 reusable primitive만 둔다.
- `api/*`는 HTTP client와 endpoint wrapper를 소유한다.
- `websocket/*`는 realtime transport adapter를 소유한다.
- feature logic을 `app/`에 직접 두지 않는다.

## 3.3 Landing code 격리

결정: `ref/landingPage`에서 가져온 design sample은 monolithic root app이 아니라 landing page와 `landing-vision` feature로 유지한다.

현재 위치:

```text
src/pages/landing/LandingPage.tsx
src/pages/landing/LandingPage.css
src/features/landing-vision/components/
src/features/landing-vision/hooks/
src/features/landing-vision/lib/
src/features/landing-vision/styles/
```

규칙:
- `LandingPage.tsx`는 page-level state와 layout 조정만 맡을 수 있다.
- Vision demo state machine, timing, component는 `features/landing-vision` 아래에 둔다.
- runtime에서 `ref/landingPage` 파일을 직접 import하지 않는다.
- `ref/landingPage/node_modules`, `dist`, `.omx`, generated artifact는 복사하지 않는다.

## 3.4 Plain CSS와 엄격한 경계 사용

결정: 당분간 plain CSS를 사용하고 Tailwind, CSS Modules, UI library는 도입하지 않는다.

근거:
- 현재 landing page는 custom animation 비중이 높다.
- 지금 styling framework를 도입하면 명확한 제품 필요 없이 migration cost만 늘어난다.

규칙:
- app-wide token은 `src/app/styles/tokens.css`에 둔다.
- 최소한의 global reset/base rule은 `src/app/styles/globals.css`에 둔다.
- page-specific style은 `src/pages/<page>/` 아래에 둔다.
- feature-specific style은 `src/features/<feature>/styles/` 아래에 둔다.
- class name은 `landing-*`, `vision-*`, `run-*`, `report-*`처럼 namespace 형태를 유지한다.
- `globals.css` 밖에서는 넓은 element selector를 피한다.

보류:
- class collision이나 ownership 관리가 어려워지면 CSS Modules를 나중에 도입할 수 있다.
- 제품 UI가 utility-first composition으로 이동할 때만 Tailwind를 재검토한다.

## 3.5 테스트 가능한 pure logic 유지

결정: animation timing과 state-machine logic은 browser 없이 테스트 가능해야 한다.

현재 예시:

```text
src/features/landing-vision/lib/heroVision.ts
src/features/landing-vision/lib/visionSequence.ts
test/landing-vision/hero-vision.test.ts
test/landing-vision/vision-sequence.test.ts
```

규칙:
- timing constant와 phase/state logic은 `lib/`에 둔다.
- React lifecycle과 DOM event wiring은 `hooks/` 또는 component에 둔다.
- animation cadence나 state transition을 바꾸기 전에는 pure logic에 focused test를 추가한다.

# 4. 보류한 기술 선택

다음 항목은 의도적으로 아직 설치하지 않았다.

## 4.1 Routing

향후 기본 선택: React Router.

의미 있는 route가 둘 이상 생기면 설치한다. 예:

```text
/
/app
/runs/:runId
/reports/:reportId
/projects/:projectId
```

그 전까지는 `App`이 `LandingPage`를 직접 render해도 된다.

## 4.2 Server state

향후 기본 선택: TanStack Query.

API 기반 제품 화면에서 caching, refetching, mutation state, retry, cache invalidation이 필요해지면 설치한다.

server state에는 일반 client-state store를 기본으로 사용하지 않는다.

## 4.3 Client state

아직 global client-state library는 선택하지 않았다.

먼저 React local state를 사용한다. cross-page client-only state가 prop drilling이나 context 과사용 없이 관리하기 어려워질 때만 작은 client-state store를 검토한다.

## 4.4 Forms

아직 form library는 선택하지 않았다.

scenario builder, project settings, report configuration form이 validation, touched state, field array, schema integration을 필요로 할 만큼 복잡해질 때 선택한다.

## 4.5 Component testing

현재 테스트는 logic과 source-shape regression test에 `node:test` + `tsx`를 사용한다.

DOM/component behavior를 manual/browser QA 밖에서 검증할 필요가 커지면 Vitest + Testing Library를 검토한다.

## 4.6 UI component library

아직 UI component library는 선택하지 않았다.

제품 dashboard surface가 안정화되면 재검토한다. landing page는 custom 상태를 유지하며 component library 결정을 강제하지 않는다.

## 4.7 React major upgrade policy

React 18이 현재 runtime baseline이다.

React major upgrade는 별도 change로 진행하고 다음을 포함한다.
- dependency update
- build verification
- typecheck verification
- 관련 runtime smoke test
- 변경된 React behavior에 대한 note

# 5. Agent 구현 규칙

`apps/web`을 변경할 때:

1. 먼저 이 문서를 확인한다.
2. 새 코드는 소유권이 있는 가장 작은 page/feature/shared 경계 안에 둔다.
3. 구체적 요구사항이 없으면 dependency를 추가하지 않는다.
4. 새 source file은 TypeScript/TSX를 우선한다.
5. pure logic은 `lib/`에 두고 테스트한다.
6. 다음 명령을 실행한다.

```bash
cd apps/web
npm test
npm run build
npm run typecheck
```

7. dependency가 바뀌었다면 다음 명령도 실행한다.

```bash
npm audit --omit=dev
npm audit
```

# 6. 현재 follow-up

- 두 번째 route가 구현되면 routing을 추가한다.
- Spring API endpoint가 연결되면 API client module을 추가한다.
- API contract가 안정화되면 `packages/contracts/openapi/wedge_openapi.yaml` 기반 generated type 또는 client code를 검토한다.
- landing interaction이 business-critical해지면 component/browser-level test를 검토한다.
