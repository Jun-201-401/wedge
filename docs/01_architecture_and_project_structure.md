# 01. 시스템 아키텍처와 프로젝트 구조

## 1. 아키텍처 목표

Wedge의 핵심은 실제 브라우저 실행과 evidence 기반 판단이다.  
따라서 아키텍처는 다음 책임을 분리한다.

```text
React Client
  → Spring API Server
      → Site Discovery / Preflight
      → Scenario Recommendation
      → ScenarioAuthoring
      → Scenario Confirmation
      → Full Run
      → PostgreSQL
      → S3 Artifact Store
      → WebSocket
      → Remote MCP Adapter
      → RabbitMQ
          → Node Playwright Runner
          → FastAPI Analyzer
          → report export worker (optional)
```

React는 Runner/Analyzer와 직접 통신하지 않는다. 모든 상태 변경과 live event 발행은 Spring API Server를 통해 처리한다.

## 2. 컴포넌트 책임

### 2.1 React Client

주요 책임:

- URL 입력
- Site Discovery / Preflight 시작
- Discovery 진행 상태와 추천 시나리오 확인
- ScenarioAuthoring 화면에서 추천 기반 ScenarioPlan candidate 확인/선택
- 시나리오 템플릿 선택 또는 guided custom scenario 수정
- device 선택
- run 실행/중지 요청
- live progress 표시
- latest frame/checkpoint 표시
- report 확인
- report share 링크 생성/확인

### 2.2 Spring API Server

Spring은 Wedge의 기준 서버다.

주요 책임:

- 사용자/워크스페이스/프로젝트 관리
- discovery lifecycle 관리
- scenario recommendation 저장/조회
- ScenarioAuthoring job/result 저장/검증
- run lifecycle 관리
- 상태 전이 검증
- REST API
- Internal callback 수신
- RabbitMQ publish
- WebSocket event 발행
- MCP adapter
- OAuth/OIDC integration
- DB write의 최종 소유권

Spring만 DB의 canonical run status를 갱신한다.  
Runner와 Analyzer는 Spring에 callback을 보내고, Spring이 DB에 반영한다.

### 2.3 Node Playwright Runner

주요 책임:

- Discovery execute request 또는 ScenarioPlan 수신
- Playwright browser/context/page 생성
- Discovery 제한 action 또는 full-run action 실행
- settle strategy 수행
- checkpoint 생성
- screenshot, DOM, layout, AX, network, console, performance 요약 수집
- artifact S3 업로드
- Spring internal callback 호출

Runner는 DB에 직접 쓰지 않는다. 현재 run 실행 경로에서 Runner는 고정된 `ScenarioPlan` executor이며, Discovery 추천을 authoring하거나 ScenarioPlan을 생성/수정하지 않는다. Runner Agent Runtime은 이 경로를 바꾸지 않고 별도 `AgentTask` / `AgentTrace` / `agent.execute.request` 경로로 동작한다.

### 2.4 FastAPI Analyzer

주요 책임:

- SiteDiscoveryResult 또는 EvidencePacket 입력
- flow candidate / scenario recommendation 평가
- ScenarioAuthoring 입력으로 사용할 recommendation rationale 제공
- RuleRegistry 로드
- StageResolver 실행
- StageContextBuilder로 stage별 evidence context 구성
- Observation → Signal → Judgment 계산
- severity/confidence/priority 계산
- JudgeResult 생성
- LLM explanation/Nudge 생성
- Analyzer callback 호출

FastAPI는 run lifecycle의 기준 서버가 아니다.

Analyzer의 Stage 책임은 code-level enum 처리다. Stage는 LLM이 판단하는 심리 상태가 아니라 `ScenarioStep.stage`, `Checkpoint.primaryStage`, `Observation.stage`, `Rule.applicableStages`, `JudgeIssue.stage`, `DecisionMapItem.stage`를 연결하는 operational label이다.

### 2.5 RabbitMQ

RabbitMQ는 작업 분배용이다.

- `discovery.execute.request`: Spring → Node Runner
- `discovery.evaluate.request`: Spring → Spring 또는 FastAPI Analyzer
- `run.execute.request`: Spring → Node Runner
- `agent.execute.request`: Spring → Node Runner Agent Runtime
- `analysis.request`: Spring → FastAPI Analyzer
- `report.export.request`: Spring → export worker(optional)

RabbitMQ는 최종 상태 저장소가 아니다.

### 2.6 S3 Artifact Store

저장 대상:

- checkpoint screenshot
- Playwright trace
- HAR
- raw DOMSnapshot
- raw AX tree
- generated report

DB에는 artifact metadata와 signed URL 발급용 key만 저장한다.

### 2.7 Site Discovery / Preflight

Site Discovery는 정식 Run 전에 URL에서 가능한 사용자 흐름을 찾는 lightweight evidence collection 단계다.

책임:

- 입력 URL 접속과 final URL 확인
- first-view checkpoint 수집
- header/nav 탐색
- CTA/form/pricing/contact/signup/checkout 후보 탐지
- 1~2회 제한 scroll
- flow candidate 생성
- scenario recommendation 생성
- 정식 Run에 사용할 suggested start URL 또는 candidate target 제공

Discovery는 Browser Runner를 재사용하되 full Run보다 제한된 action set만 사용한다.

Allowed actions:

- `goto`
- `checkpoint`
- `limited_scroll`
- `collect_links`
- `collect_cta_candidates`
- `collect_form_candidates`
- `collect_pricing_checkout_candidates`

Blocked actions:

- form submit
- payment commit
- destructive action
- OAuth/CAPTCHA completion
- deep crawling

원칙:

- Discovery는 full run이 아니다.
- Discovery 결과는 정식 Run 생성에 사용될 수 있다.
- Discovery checkpoint와 Run checkpoint는 같은 observation/artifact 구조를 재사용한다.
- Discovery 결과가 없거나 low confidence여도 사용자는 수동으로 시나리오를 선택할 수 있다.


### 2.8 ScenarioAuthoring

ScenarioAuthoring은 Discovery recommendation과 Run materialization 사이의 계약 단계다. 추천 카드를 그대로 Run으로 바꾸지 않고, provider가 검증 가능한 `ScenarioPlan` 후보를 제출하는 `ScenarioAuthoringJob` / `ScenarioAuthoringResult` 경계를 먼저 둔다.

책임:

- Discovery recommendation을 기반으로 scenario type, start URL, target hints, goal, device를 authoring input으로 고정
- Codex/Claude Code/Internal LLM/Rule-based provider가 제출한 후보를 검증 가능한 result로 저장
- 추천 evidence refs와 사용자가 확정한 실행 의도를 연결
- Run 생성 전에 ScenarioPlan materialization에 필요한 입력을 안정화

원칙:

- ScenarioAuthoring은 V1 계약 경계다. API/DB/provider/runtime 구현은 후속 작업으로 미룬다.
- Runner는 ScenarioAuthoring에 참여하지 않는다. ScenarioAuthoring 기반 Run 경로에서 Runner는 Spring이 materialize한 고정 `ScenarioPlan`만 실행한다.
- Runner Agent Runtime은 ScenarioAuthoring을 대체하지 않는다. Agent Runtime은 별도 `AgentTask` 실행 경로이며, 성공한 `AgentTrace`를 나중에 검증된 `ScenarioPlan` 후보로 export할 수 있을 뿐이다.
- ScenarioAuthoring은 browser-control API가 아니다. URL 탐색은 Discovery가, 실행은 Run이 담당한다.
- ScenarioAuthoring 결과가 없어도 기존 템플릿 기반 Run 생성 경로는 유지될 수 있다.

## 3. 핵심 실행 흐름

```text
1. User submits URL via /api/discoveries
2. Spring stores site_discovery(status=CREATED/QUEUED) and publishes discovery.execute.request
3. Node Runner executes limited Discovery actions: goto, checkpoint, limited_scroll, collect_links, collect_cta_candidates, collect_form_candidates, collect_pricing_checkout_candidates
4. Runner sends discovery checkpoint/artifact/observation callbacks to Spring
5. Runner finishes with finalUrl and raw summary
6. Spring or FastAPI Analyzer evaluates lightweight flow candidates and stores scenario_recommendation rows
7. React renders Scenario Recommendation cards and opens ScenarioAuthoring for the selected candidate
8. ScenarioAuthoring provider submits one or more validated ScenarioPlan candidates with provenance
9. User or trusted service confirms a ScenarioAuthoring candidate for Run materialization
10. Spring creates test_run with source_discovery_id and materializes ScenarioPlan + fit_requirements
11. Full Run performs scenario fit check before risky/deep actions
12. If fit is applicable, Runner executes the fixed ScenarioPlan and collects checkpoint evidence
13. If fit is not applicable, Spring/Runner records scenario_fit_status and ScenarioMismatchReport without treating it as a system failure
14. Spring materializes EvidencePacket from checkpoint/observation/artifact rows
15. Spring stores an EvidencePacket snapshot, creates analysis_job, and publishes analysis.request with evidencePacketId
16. Analyzer runs StageResolver, builds StageContext objects, and evaluates only rules whose applicableStages match each context
17. Analyzer produces JudgeResult; scenario mismatch remains separate from UX scoring unless the user goal explicitly asks for that entrypoint
18. Spring stores analysis_job, rule_hit, analysis_finding, nudge from Analyzer callback; report rows are generated by Spring report API/service from the completed analysis result
19. React receives WebSocket events and renders discovery, authoring, run, Decision Map report, or mismatch outcome
```

Agent Runtime 실행 흐름은 기존 Run materialization 흐름과 분리한다.

```text
1. Spring creates an AgentTask, injects safe replay_hints from the latest successful AgentTrace when available, and publishes agent.execute.request
2. Node Runner Agent Runtime creates a browser session
3. Agent observes the current page and extracts bounded candidates
4. Agent verifier checks current state before asking for the next decision
5. Heuristic or LLM DecisionClient returns constrained AgentDecision JSON
6. Runtime validates the decision, applies policy, then executes a fixed Playwright tool
7. Runtime records AgentEvent / AgentTrace and persists artifacts
8. Runtime stops with typed AgentOutcome
9. Optional follow-up converts successful AgentTrace into a validated ScenarioPlan candidate for deterministic replay
```

## 4. Spring 패키지 구조

권장 패키지 구조:

```text
apps/api-server/
  src/main/java/com/wedge/
    WedgeApplication.java

    adapter/
      rest/
        project/
        discovery/
        run/
        report/
      internal/
        discovery/
        runner/
        analyzer/
      websocket/
      mcp/
      mq/

    application/
      project/
      discovery/
      run/
      scenario/
      evidence/
      analysis/
      report/
      agent/

    domain/
      project/
      discovery/
      run/
      scenario/
      evidence/
      judge/
      report/
      agent/

    infrastructure/
      persistence/
        mapper/
        dto/
      rabbitmq/
      s3/
      security/
      oauth/
      websocket/

    common/
      error/
      id/
      time/
      json/
      validation/
```

규칙:

- REST/MCP/Internal callback은 `application` service를 호출한다.
- domain package는 framework 의존성을 최소화한다.
- MyBatis mapper는 infrastructure에 둔다.
- 상태 전이 검증은 `application.run`에 둔다.
- DB write는 Spring service transaction 안에서 처리한다.

## 5. Node Runner 구조

```text
apps/runner/
  src/
    index.ts
    config/
    queue/
    scenario/
      scenarioPlanSchema.ts
      scenarioValidator.ts
    executor/
      discoveryExecutor.ts
      fullRunExecutor.ts
      playwrightExecutor.ts
      actionHandlers/
      settleStrategies/
    agent/                    # planned Agent Runtime path; separate from scenario executor
      session.ts
      observer.ts
      candidates.ts
      policy.ts
      verifier.ts
      trace.ts
      tools.ts
      decision/
    collectors/
      checkpointCollector.ts
      ctaCandidateCollector.ts
      flowCandidateCollector.ts
      domCollector.ts
      layoutCollector.ts
      axCollector.ts
      networkCollector.ts
      consoleCollector.ts
      performanceCollector.ts
    evidence/
      checkpointNormalizer.ts
      observationExtractor.ts
    callbacks/
      discoveryCallbackClient.ts
      springCallbackClient.ts
    artifacts/
      s3ArtifactClient.ts
    common/
      logger.ts
      errors.ts
```

## 6. FastAPI Analyzer 구조

```text
apps/analyzer/
  app/
    main.py
    api/
      health.py
      analyze.py
    stage/
      stage_resolver.py
      stage_context_builder.py
    discovery/
      flow_candidate_extractor.py
      scenario_recommender.py
    rule_engine/
      registry_loader.py
      evaluator.py
      scoring.py
      criteria/
    llm/
      prompt_builder.py
      nudge_generator.py
      constraints.py
    contracts/
      evidence_packet.py
      rule_registry.py
      judge_result.py
    callbacks/
      spring_callback.py
    tests/
```

StageResolver responsibilities:

- `ScenarioStep.stage`를 checkpoint `primaryStage`에 전달한다.
- observation type에 따라 `Observation.stage`를 보정한다.
- checkpoint 안의 여러 observation이 서로 다른 stage를 가질 수 있게 허용한다.
- LLM이 stage를 임의 판단하지 않도록 보장한다.

Analyzer Judge flow:

```text
EvidencePacket
  → StageResolver
  → StageContextBuilder
  → RuleEngine
  → JudgeResult
  → LLMExplainer
```

LLMAnalyzer / LLMExplainer는 다음을 하지 않는다.

- Stage 결정
- severity/confidence 변경
- evidence 없는 issue 생성
- criterion에 없는 문제명 생성

LLMAnalyzer / LLMExplainer는 다음만 한다.

- explanation
- Nudge
- validation questions
- report language polish

구현 원칙:

- Stage는 code-level enum이다.
- Stage는 report grouping과 priority calculation에 사용된다.
- Rule Engine은 stage별 context에서 rule을 실행한다.

## 7. React 구조

```text
apps/web/
  src/
    app/                 # app bootstrap, providers, global styles
    pages/               # route-level orchestration only
      landing/
      CreateAnalysisPage.tsx
      DiscoveryResultPage.tsx
      RunCreatePage.tsx
      RunDetailPage.tsx
      ReportPage.tsx
    features/            # feature-owned UI/state/effects
      discovery/
        UrlInputStep.tsx
        DiscoveryProgress.tsx
        ScenarioRecommendationList.tsx
        GuidedScenarioBuilder.tsx
      scenario-builder/
      run-monitor/
      report-viewer/
      landing-vision/
    entities/            # stable domain models when repeated across features
    shared/              # reusable primitives only after repeated use exists
    api/                 # generated or handwritten API client boundary
    websocket/           # run socket/reducer boundary
    types/
```

## 8. 팀 담당 영역

| Area | Owner | Support |
|---|---|---|
| Product/Tech direction | 강보승 | 박성환 |
| Spring architecture | 강보승 | 정관우, 장현준 |
| Spring implementation | 정관우 | 박성환 |
| Node Runner | 차지훈 | 장현준 |
| Runner infra/reliability | 장현준 | 차지훈 |
| FastAPI/Judge | 유지호 | 강보승 |
| Report UI | 강보승 | 차지훈 |
| Jira/QA/docs | 박성환 | 전체 |
