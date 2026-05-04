# Wedge

**Wedge**는 웹사이트의 사용 흐름을 직접 실행해보고, 사용자가 어디서 망설이거나 이탈할 수 있는지 evidence 기반으로 찾아주는 UX 진단 서비스입니다.

사용자는 먼저 분석하고 싶은 URL을 입력합니다. Wedge는 곧바로 정식 실행을 시작하지 않고, Site Discovery / Preflight로 첫 화면, 내비게이션, CTA, form, pricing/contact/checkout 진입점을 가볍게 확인한 뒤 해당 URL에 적합한 시나리오를 추천합니다. 사용자는 추천 시나리오를 선택하거나 guided custom scenario로 수정한 다음 정식 Run을 실행합니다.

```text
URL 입력
  → Site Discovery / Preflight
  → 추천 시나리오 확인
  → 사용자가 시나리오 선택 또는 수정
  → 실제 브라우저 Run 실행
  → 단계별 evidence 수집
  → 전환/UX 리스크 판단
  → 개선 제안 리포트
```

## 왜 필요한가요?

웹사이트의 문제는 단순히 “페이지가 예쁜가”로 결정되지 않습니다.

사용자는 첫 화면에서 계속 볼지 판단하고, CTA를 눌러도 될지 고민하고, 입력 폼에서 피로를 느끼고, 제출 직전에 신뢰할 수 있는지 다시 확인합니다. 이런 순간들은 정적 분석이나 단순 스크린샷만으로는 놓치기 쉽습니다.

Wedge는 실제 사용 흐름 속에서 다음 질문에 답하려고 합니다.

- 사용자가 첫 화면에서 가치를 바로 이해할 수 있는가?
- 다음 행동이 명확하게 보이는가?
- 입력 과정에서 불필요한 부담이나 오류가 있는가?
- 제출/가입/문의 직전에 충분한 신뢰를 주는가?
- 기술적 오류가 전환 흐름을 방해하지 않는가?

## Wedge가 하는 일

### 1. URL-first Site Discovery

사용자가 URL을 입력하면 Wedge는 전체 분석 전에 짧은 Discovery를 실행합니다. Discovery는 first view, header/nav, CTA 후보, form 후보, pricing/contact/signup/checkout 진입점을 확인해 `LANDING_CTA`, `SIGNUP_LEAD_FORM`, `PRICING`, `PURCHASE_CHECKOUT`, `CONTACT`, `CONTENT_ONLY` 같은 시나리오 후보를 추천합니다.

### 2. 실제 사용자 흐름 실행

단순히 HTML을 읽는 것이 아니라, 브라우저에서 사용자의 행동을 재현합니다. 랜딩 페이지 확인, CTA 클릭, 회원가입 폼 입력, 가격 페이지 탐색처럼 실제 전환 흐름에 가까운 시나리오를 실행합니다. 정식 Run은 Discovery 결과나 사용자의 직접 선택을 바탕으로 생성됩니다.

### 3. 단계별 evidence 수집

각 행동 이후의 화면과 상태를 checkpoint로 남깁니다. 문제가 발생한 순간을 근거와 함께 연결하기 때문에, “왜 문제인지”를 설명할 수 있습니다.

### 4. UX/전환 리스크 판단

Wedge는 수집한 evidence를 바탕으로 명확성, 행동 경로, 마찰, 신뢰, 안정성, 시각적 위계 같은 관점에서 리스크를 판단합니다.

### 5. 개선 제안 리포트 제공

사용자가 바로 이해할 수 있도록 핵심 문제, 근거, 영향, 개선 방향을 리포트로 정리합니다. 단순 점수보다 “어느 순간에 왜 막히는지”를 보여주는 것이 목표입니다.

## 주요 사용 사례

- 랜딩 페이지의 첫인상과 CTA 흐름 점검
- 회원가입/문의/리드 폼의 이탈 요인 확인
- 가격 페이지나 결제 직전 화면의 신뢰 요소 점검
- 모바일 화면에서 버튼 크기, 가독성, 전환 흐름 확인
- 배포 전 핵심 전환 시나리오 QA
- 개선 전/후 리포트를 비교하며 UX 변경 효과 확인

## 우리가 중요하게 보는 것

- **URL-first guidance**: 사용자가 어떤 시나리오를 선택해야 할지 모를 때 Wedge가 먼저 가능한 흐름을 추천합니다.
- **실제 흐름**: 페이지 하나가 아니라 사용자의 행동 흐름을 봅니다.
- **근거 기반 판단**: 모든 지적은 수집된 evidence와 연결되어야 합니다.
- **재현 가능성**: 같은 시나리오를 다시 실행해 비교할 수 있어야 합니다.
- **설명 가능한 리포트**: 막연한 평가가 아니라 행동 리스크와 개선 방향을 제시합니다.
- **작은 팀도 쓸 수 있는 UX 진단**: 전문 리서치 리소스가 부족해도 핵심 전환 문제를 빠르게 확인할 수 있게 합니다.

## 현재 프로젝트 상태

Wedge는 현재 제품 설계, 핵심 계약, 서비스 기반 구조, 그리고 웹 사용자 인증과 공통 API 응답 기반을 갖춰가고 있습니다.

앞으로는 브라우저 실행, evidence 수집, Judge/Analyzer, 리포트 화면을 단계적으로 연결해 실제 URL 진단이 가능한 형태로 발전시킬 예정입니다.


## 로컬 MVP smoke 점검

Runner/Analyzer까지 연결된 최소 MVP 플로우를 확인할 때는 Swagger에서 internal callback payload를 직접 입력하지 말고, public Run API가 MQ를 발행하고 Runner/Analyzer가 callback을 보내는 경로를 사용한다.

1. 개발 인프라 실행

```bash
docker compose -f compose.dev.yaml up -d postgres rabbitmq redis minio runner analyzer-worker
```

2. 기존 dev DB가 오래된 상태라면 checked-in migration을 먼저 적용한다.

```bash
node infra/scripts/apply-dev-db-migrations.mjs
```

기본 DB 컨테이너 이름은 `wedge-postgres-dev`다. 다른 컨테이너를 쓰는 경우 예를 들어:

```bash
WEDGE_DEV_DB_CONTAINER=wedge-dev-postgres-alt node infra/scripts/apply-dev-db-migrations.mjs
```

3. smoke project/scenario seed를 넣는다. 이 스크립트는 `e2e-smoke@wedge.local` 사용자가 이미 존재하면 `workspace_member`와 `project_member`도 함께 보정한다.

```bash
node infra/scripts/seed-real-run-smoke.mjs
```

4. API 서버를 실행한다.

```bash
cd apps/api-server && gradle bootRun
```

5. 전체 Run smoke를 실행한다.

```bash
node infra/scripts/real-run-e2e-smoke.mjs
```

성공 기준은 Run `COMPLETED`, EvidencePacket checkpoint/artifact 생성, 필요 시 `/api/runs/{runId}/analysis` 이후 `analysisStatus=COMPLETED`, `/api/runs/{runId}/report`의 `status=READY`다.

## 핵심 용어

- **Site Discovery**: URL을 가볍게 탐색해 가능한 시나리오를 추천하는 사전 단계입니다.
- **Preflight**: Site Discovery와 같은 의미로 UI/프로세스에서 사용할 수 있는 표현입니다.
- **Scenario Recommendation**: 발견된 CTA/form/pricing/checkout/contact 후보를 바탕으로 추천한 분석 시나리오입니다.
- **Scenario Fit Status**: 선택한 시나리오가 해당 URL에서 실행 가능한지 나타내는 상태입니다.
- **Scenario Mismatch Report**: 선택한 시나리오가 URL에 맞지 않을 때 생성하는 불일치 리포트입니다. 이는 시스템 실패나 UX 결함 판정이 아니라 URL과 시나리오의 적용 가능성 결과입니다.

## 문서 읽는 순서

1. `docs/00_master_decisions.md` — 제품/기술 결정 기준
2. `docs/01_architecture_and_project_structure.md` — Discovery를 포함한 서비스 구조
3. `docs/03_api_reference.md` — Discovery와 Run API 흐름
4. `docs/04_domain_payload_contracts.md` — SiteDiscoveryResult, ScenarioPlan, EvidencePacket 계약
5. `packages/contracts/openapi/wedge_openapi.yaml` — machine-readable REST 계약
