# Wedge 프로그램 명세서
## 모듈 분해 및 책임 정의 초안

## 1. 문서 목적

본 문서는 Wedge 시스템을 구현 가능한 모듈 단위로 분해하고, 각 모듈의 책임, 소유 범위, 연동 방식, 담당 영역을 명확히 정리하기 위한 명세서이다.  
이 문서는 제품 소개보다 **개발 단위 분해와 구현 경계 정의**를 우선하며, 팀 단위 병렬 개발과 통합 기준을 제공하는 것을 목적으로 한다.

본 문서에서 다루는 핵심 질문은 다음과 같다.

- 시스템을 어떤 기준으로 모듈 단위로 분해할 것인가
- 각 모듈은 어떤 책임을 가지는가
- 어떤 책임은 묶고, 어떤 책임은 분리해야 하는가
- 각 모듈은 누구의 담당 범위로 보는 것이 적절한가
- 모듈 간에는 어떤 인터페이스로 연결되는가

---

## 2. 모듈 분해 원칙

Wedge의 모듈 분해는 기능 실행 순서나 기술 종류만을 기준으로 하지 않고, **변경 이유, 상태 소유권, 업무 책임, 도메인 경계**를 기준으로 수행한다.  
이를 위해 다음 원칙을 적용한다.

### 2.1 변경 이유가 같은 것끼리 묶는다
같은 이유로 함께 수정될 가능성이 높은 기능은 하나의 모듈 안에 둔다.  
예를 들어 run 상태 전이, callback 반영, analysis job 생성은 모두 Spring의 오케스트레이션 책임과 함께 바뀔 가능성이 높으므로 같은 중심 모듈 안에서 관리하는 것이 적절하다.

### 2.2 상태 소유권이 다른 것은 분리한다
Wedge는 Spring API Server를 상태 기준 서버로 둔다.  
따라서 상태를 최종 반영하는 책임과 실행을 수행하는 책임, 분석을 수행하는 책임은 분리한다.  
Runner와 Analyzer는 처리 주체이지만, 상태의 최종 소유자는 아니다.

### 2.3 업무 용어와 모델이 다른 것은 분리한다
브라우저 실행 단계에서 사용하는 개념과 분석 단계에서 사용하는 개념, 사용자 리포트 단계에서 사용하는 개념은 서로 다르다.  
예를 들어 Runner는 page, action, checkpoint, screenshot 중심으로 동작하고, Analyzer는 observation, signal, criterion, judge result 중심으로 동작한다.  
이처럼 용어와 모델이 다른 영역은 별도 모듈로 분리하는 것이 적절하다.

### 2.4 전송 방식은 독립 업무 모듈이 아니라 연결 수단으로 본다
RabbitMQ, Internal Callback, WebSocket은 도메인 그 자체가 아니라 모듈을 연결하는 인터페이스 또는 전달 수단으로 본다.  
따라서 MQ 모듈, WebSocket 모듈을 업무 모듈처럼 최상위로 분리하기보다, 각 도메인 모듈이 어떤 인터페이스를 통해 연결되는지로 설명하는 것이 적절하다.

### 2.5 높은 응집도와 낮은 결합도를 우선한다
각 모듈은 가능한 한 단일 책임에 가까운 응집도를 가지도록 하며, 다른 모듈과의 결합은 REST, MQ, Callback, WebSocket, Contract 등 명시적 인터페이스를 통해 제한한다.

### 2.6 owner가 명확한 단위로 나눈다
모듈은 구현 책임자와 도메인 owner가 자연스럽게 대응될 수 있어야 한다.  
이는 병렬 개발, 코드 리뷰, 장애 추적, 변경 영향 분석 측면에서 중요하다.

---

## 3. 최상위 시스템 모듈 구성

Wedge 시스템은 다음의 최상위 모듈로 구분하는 것이 적절하다.

| 모듈 | 핵심 책임 | owner/도메인 | 주요 인터페이스 | 분리 이유 |
|---|---|---|---|---|
| Web Client | 사용자 입력, 실행 요청, 진행 상태 확인, report 조회 | Frontend / UI | REST, WebSocket | 사용자 인터페이스와 서버 내부 책임 분리 |
| Spring Orchestration Core | run lifecycle 관리, 상태 전이 검증, callback 수신, MQ 발행, DB 반영, WebSocket event 발행 | Spring Core Backend | REST, Internal Callback, MQ, WebSocket, DB | 상태 기준 서버 및 중앙 조정 책임 집중 |
| Browser Execution Runner | 실제 브라우저 실행, step 수행, checkpoint 및 artifact 생성 | Runner / Browser Execution | MQ consume, Internal Callback, S3 | 실행 책임과 상태 저장 책임 분리 |
| Analysis / Judge Engine | EvidencePacket 기반 Rule 평가, JudgeResult 생성, explanation/nudge 생성 | Analyzer / AI & Rule | MQ consume, Internal Callback | 실행 도메인과 분석 도메인 분리 |
| Contracts | OpenAPI, schema, MQ/websocket/internal callback 계약, shared enum 관리 | Shared Contract | OpenAPI, JSON Schema | 공통 source of truth 유지 |
| Infra Platform | RabbitMQ, S3, Docker, 배포, 운영 안정성 관리 | Infra / Reliability | 인프라 자원, 배포 환경 | 운영 기반과 업무 로직 분리 |

---

## 4. 최상위 모듈 분해 판단

### 4.1 Web Client
Web Client는 사용자가 시스템과 상호작용하는 진입점이다.  
이 모듈은 URL과 시나리오 입력, 실행 요청, 상태 표시, 결과 리포트 조회를 담당한다.  
직접 실행 로직이나 분석 로직을 갖지 않으며, 모든 상태 조회와 이벤트 수신은 Spring API Server를 통해 이루어진다.

### 4.2 Spring Orchestration Core
Spring Orchestration Core는 Wedge의 중앙 기준 서버이다.  
이 모듈은 run 생성, 시작, 중지, 상태 전이, callback 수신, EvidencePacket materialize, analysis job 생성, report 반영 등 전체 파이프라인의 오케스트레이션 책임을 가진다.  
또한 PostgreSQL에 대한 최종 write 소유권을 가지므로, Wedge의 핵심 도메인 모듈로 본다.

### 4.3 Browser Execution Runner
Runner는 실제 브라우저에서 시나리오를 실행하는 실행 모듈이다.  
Playwright 기반 실행, action 수행, checkpoint 생성, screenshot/DOM/layout/AX/network/console 수집을 담당한다.  
실행은 수행하지만 상태 저장의 최종 주체는 아니므로 Spring과 분리된 실행 전용 모듈로 두는 것이 적절하다.

### 4.4 Analysis / Judge Engine
Analyzer는 실행 결과를 EvidencePacket으로 받아 규칙 기반 평가와 LLM 기반 설명 생성을 수행한다.  
이 모듈은 Observation → Signal → Judgment 흐름과 RuleRegistry, JudgeResult, explanation, nudge를 중심으로 하는 별도 도메인 모델을 가지므로, Runner나 Spring과 다른 도메인 모듈로 분리하는 것이 적절하다.

### 4.5 Contracts
Contracts는 서비스 간 공통 규격을 정의하는 기준 패키지이다.  
REST, callback, MQ, WebSocket, domain payload, shared enum을 하나의 source of truth로 유지하여, 모듈 간 연결 규칙을 중앙화한다.

### 4.6 Infra Platform
Infra Platform은 메시지 브로커, 저장소, 배포 환경, 운영 안정성 등 실행 환경을 제공하는 모듈이다.  
업무 로직과 직접 섞이지 않도록 분리하며, 장애 대응과 운영 관리 측면에서 별도 owner를 두는 것이 적절하다.

---

## 5. Spring 내부 도메인 모듈 분해

Spring API Server 내부는 하나의 큰 서버로 두되, 내부 도메인은 다시 다음과 같이 분해하는 것이 적절하다.

| Spring 내부 모듈 | 핵심 책임 | owner 성격 | 함께 바뀌는 요소 | 분리 이유 |
|---|---|---|---|---|
| run | run 생성/조회/시작/중지, run/step 상태 전이, lifecycle 정책 | 정관우 중심 | run status, step status, transition policy | 중앙 기준 서버의 핵심 실행 도메인 |
| scenario | scenario template version 고정, scenarioPlan materialize, step 기준 해석 | Spring + Scenario 계약 | template version, plan 생성 규칙 | 실행 준비 책임을 별도 관리 |
| evidence | checkpoint/artifact/observation 저장, EvidencePacket materialize | Spring backend | checkpoint, artifact metadata, observation, evidence packet | 실행 결과 구조화 책임 분리 |
| analysis | analysis_job 생성, `analysis.request` 발행, analyzer callback 수신, JudgeResult 저장 | Spring + Analyzer 연동 | analysis status, queue payload, callback payload | 분석 연계 책임을 독립 관리 |
| report | report summary/detail/share, report permission 처리 | Spring + Report 소비 | report projection, share, permission | 사용자 소비 결과를 별도 분리 |
| agent/auth/policy | MCP, client scope, policy, invocation log, 권한 연계 | Spring + Auth/Agent | scope, policy, audit | 일반 run 도메인과 보안/agent 책임 분리 |

---

## 6. Spring 내부 모듈 분해 판단

### 6.1 run
`run` 모듈은 시스템 전체 실행 상태의 기준점이다.  
run 생성, 상태 전이, step 진행 상태, result completeness, analysis status 등은 대부분 함께 바뀌므로 하나의 중심 도메인으로 묶는 것이 적절하다.

### 6.2 scenario
`scenario` 모듈은 실행 전에 어떤 계획으로 브라우저를 움직일지 확정하는 영역이다.  
ScenarioTemplateVersion과 ScenarioPlan 해석은 실행 자체와는 밀접하지만, 상태 저장과는 다른 책임을 가진다.  
따라서 실행 도중 로직과는 분리하여 준비 책임으로 두는 것이 적절하다.

### 6.3 evidence
`evidence` 모듈은 Runner가 보낸 checkpoint와 artifact 정보를 구조화된 evidence로 정리하는 영역이다.  
이 영역은 raw execution 결과를 분석 가능한 도메인 데이터로 변환하는 역할을 가지므로, run 또는 analysis에 흡수하기보다 별도 모듈로 두는 것이 적절하다.

### 6.4 analysis
`analysis` 모듈은 Analyzer와의 연결 책임을 가진다.  
Spring이 analysis job을 만들고 MQ에 분석 요청을 보내며, Analyzer callback을 받아 JudgeResult 및 관련 projection을 저장하는 흐름이 이 모듈의 책임 범위이다.

### 6.5 report
`report` 모듈은 최종 결과를 사용자 소비 형태로 제공하는 영역이다.  
분석 결과 원본 저장과는 달리, summary/detail/share, 조회 권한 등 사용자 소비 관점이 추가되므로 별도 모듈로 두는 것이 적절하다.

### 6.6 agent/auth/policy
`agent/auth/policy` 모듈은 사람 사용자의 일반 run 흐름과 다른 보안 및 외부 agent 연계 정책을 담당한다.  
scope, policy, MCP invocation 등은 일반 run/evidence/report와 변경 이유가 다르므로 분리하는 것이 적절하다.

---

## 7. 모듈 간 연결 방식

각 모듈은 다음과 같은 인터페이스를 통해 연결된다.

| 연결 관계 | 방식 | 전달 내용 | 목적 |
|---|---|---|---|
| Web Client → Spring | REST | URL, 시나리오, run 생성/시작 요청 | 사용자 요청 진입 |
| Spring → Runner | RabbitMQ | `run.execute.request` | 실행 작업 위임 |
| Runner → Spring | Internal Callback | accepted, checkpoint, artifact, finished/failed | 실행 결과 보고 |
| Spring → Analyzer | RabbitMQ | `analysis.request` | 분석 작업 위임 |
| Analyzer → Spring | Internal Callback | completed/failed, JudgeResult | 분석 결과 보고 |
| Spring → Web Client | WebSocket | run progress, checkpoint created, latest frame, analysis finished | 실시간 UI 갱신 |
| Spring ↔ PostgreSQL | Persistence | run, step, evidence, analysis, report 저장 | 상태 기준 저장 |
| Runner ↔ S3 | Artifact storage | screenshot, trace, raw snapshot 업로드 | 대용량 artifact 저장 |

이 구조에서 RabbitMQ, Internal Callback, WebSocket은 독립 업무 모듈이 아니라 **전달 채널**로 해석한다.  
RabbitMQ는 작업을 위임하기 위한 비동기 채널이고, Internal Callback은 처리 결과를 Spring에 보고하기 위한 채널이며, WebSocket은 Spring이 사용자 화면에 실시간 진행 상태를 반영하기 위한 채널이다.

---

## 8. owner 및 담당 범위 정리

현재 프로젝트 문서 기준으로 보면, 각 최상위 모듈의 주 담당 범위는 다음과 같이 정리할 수 있다.

| 모듈 | 주 담당자 | 담당 범위 | 비고 |
|---|---|---|---|
| Spring Orchestration Core | 정관우 | run lifecycle, 상태 전이, callback 수신, MQ 연동, DB 반영 | 중앙 기준 서버 |
| Browser Execution Runner | 차지훈 | 브라우저 실행, ScenarioPlan 수행, checkpoint/artifact 생성 | Playwright 실행 도메인 |
| Analysis / Judge Engine | 유지호 | Rule engine, scoring, JudgeResult, explanation/nudge | 분석 도메인 |
| Web Client | 강보승, 차지훈 | 사용자 화면, 진행 상태 표시, report UI | FE/UI 도메인 |
| Infra Platform | 장현준 | RabbitMQ, S3, Docker, 운영 안정성 | 인프라/운영 도메인 |
| QA / Docs / Support | 박성환 | QA, 문서, evidence/report backend support | 보조 및 문서화 |
| 아키텍처/기술 방향 | 강보승 | 시스템 구조 기준, Spring 아키텍처 방향, 최종 리뷰 | Product/Tech Lead |

---

## 9. 구현 우선순위와 의존 관계

모듈 분해는 구현 우선순위와도 연결된다.  
Wedge에서는 다음 순서가 자연스럽다.

### 9.1 선행 고정이 필요한 영역
- Contracts
- Spring 내부 run / scenario / basic persistence
- DB schema
- 기본 API 응답 규칙

이 영역이 먼저 정리되어야 이후 모듈 연결이 안정적으로 가능하다.

### 9.2 계약 기준으로 병렬 개발 가능한 영역
- Runner 실행 skeleton
- Analyzer skeleton
- Web run 생성/상태 표시 UI
- Infra MQ/S3 환경

이 영역은 공통 계약이 맞으면 병렬 개발이 가능하다.

### 9.3 통합 후 완성도가 결정되는 영역
- callback 세부 반영
- EvidencePacket materialize
- analysis → report projection
- WebSocket progress 표시
- report summary/detail

이 영역은 다른 모듈이 어느 정도 살아 있어야 최종 검증이 가능하다.

---

## 10. 분해 원칙 요약

Wedge의 모듈 분해는 다음 원칙을 따른다.

1. 기능 순서보다 **변경 이유와 책임 경계**를 기준으로 모듈을 나눈다.
2. 최종 상태를 관리하는 영역과 실행을 수행하는 영역, 분석을 수행하는 영역을 분리한다.
3. 용어와 도메인 모델이 다른 영역은 별도 모듈로 분리한다.
4. MQ, Callback, WebSocket은 독립 업무 모듈이 아니라 전달 수단으로 본다.
5. 각 모듈은 높은 응집도와 낮은 결합도를 목표로 한다.
6. 각 모듈은 owner가 명확하고 병렬 개발 가능한 단위로 정의한다.

---

## 11. 결론

Wedge는 단일 서버 내부에 모든 책임을 넣는 구조보다,  
**Spring 중심 오케스트레이션 + Runner 실행 + Analyzer 분석 + Web 소비 + Contracts 기준 + Infra 운영**의 구조로 분해하는 것이 적절하다.

또한 Spring 내부도 하나의 덩어리로 두기보다  
`run / scenario / evidence / analysis / report / agent-auth-policy`의 도메인 단위로 분리하는 것이 유지보수성과 병렬 개발성 측면에서 유리하다.

따라서 본 명세서는 기술 요소 자체를 나열하는 방식보다,  
**어떤 책임이 어디에 속하는지, 왜 함께 묶였는지, 어떤 owner가 담당하는지**를 중심으로 시스템을 설명하는 방향으로 유지하는 것이 적절하다.

---

## 참고 문서

### 프로젝트 내부 문서
- `S14P31C104/README.md`
- `S14P31C104/docs/00_master_decisions.md`
- `S14P31C104/docs/01_architecture_and_project_structure.md`
- `S14P31C104/docs/03_api_reference.md`
- `S14P31C104/docs/04_domain_payload_contracts.md`
- `S14P31C104/docs/06_delivery_plan.md`
- `S14P31C104/packages/contracts/README.md`

### 이론 및 외부 참고 자료
- David L. Parnas, *On the Criteria To Be Used in Decomposing Systems into Modules*  
  DOI: https://doi.org/10.1145/361598.361623
- Eric Evans, *DDD Reference*  
  https://www.domainlanguage.com/ddd/reference/
- Chris Richardson, *Decompose by Subdomain*  
  https://microservices.io/patterns/decomposition/decompose-by-subdomain
- Chris Richardson, *Decompose by Business Capability*  
  https://microservices.io/patterns/decomposition/decompose-by-business-capability
- Thoughtworks Technology Radar  
  https://www.thoughtworks.com/radar
- SEI, *Modularizing Your Software*  
  https://www.sei.cmu.edu/library/modularizing-your-software/
- InfoQ Architecture  
  https://www.infoq.com/architecture/
