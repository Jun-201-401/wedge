# 01. System Architecture and Project Structure

## 1. Architecture Goal

Wedge의 핵심은 실제 브라우저 실행과 evidence 기반 판단이다.  
따라서 아키텍처는 다음 책임을 분리한다.

```text
React Client
  → Spring API Server
      → PostgreSQL
      → S3 Artifact Store
      → WebSocket
      → Remote MCP Adapter
      → RabbitMQ
          → Node Playwright Runner
          → FastAPI Analyzer
          → report export worker (optional)
```

React는 Runner/Analyzer와 직접 통신하지 않는다. 모든 상태 변경과 live event 발행은 Spring API Server를 통한다.

## 2. Component Responsibilities

### 2.1 React Client

Responsibilities:

- URL 입력
- 시나리오 템플릿 선택
- device 선택
- run 실행/중지 요청
- live progress 표시
- latest frame/checkpoint 표시
- report 확인
- report share 링크 생성/확인

### 2.2 Spring API Server

Spring은 Wedge의 기준 서버다.

Responsibilities:

- 사용자/워크스페이스/프로젝트 관리
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

Responsibilities:

- ScenarioPlan 수신
- Playwright browser/context/page 생성
- action 실행
- settle strategy 수행
- checkpoint 생성
- screenshot, DOM, layout, AX, network, console, performance 요약 수집
- artifact S3 업로드
- Spring internal callback 호출

Runner는 DB에 직접 쓰지 않는다.

### 2.4 FastAPI Analyzer

Responsibilities:

- EvidencePacket 입력
- RuleRegistry 로드
- Observation → Signal → Judgment 계산
- severity/confidence/priority 계산
- JudgeResult 생성
- LLM explanation/Nudge 생성
- Analyzer callback 호출

FastAPI는 run lifecycle의 기준 서버가 아니다.

### 2.5 RabbitMQ

RabbitMQ는 작업 분배용이다.

- `run.execute.request`: Spring → Node Runner
- `analysis.request`: Spring → FastAPI Analyzer
- `report.export.request`: Spring → export worker(optional)

RabbitMQ는 최종 상태 저장소가 아니다.

### 2.6 S3 Artifact Store

Stores:

- checkpoint screenshot
- Playwright trace
- HAR
- raw DOMSnapshot
- raw AX tree
- generated report

DB에는 artifact metadata와 signed URL 발급용 key만 저장한다.

## 3. Core Execution Flow

```text
1. User creates run via /api/runs with scenarioTemplateVersionId
2. Spring fixes the ScenarioTemplateVersion and materializes scenarioPlan
3. Spring stores test_run(status=CREATED, scenario_plan_jsonb=...)
4. User starts run
5. Spring stores status=QUEUED and publishes run.execute.request with scenarioPlan
6. Node Runner consumes message
7. Runner calls /internal/runner/runs/{runId}/accepted
8. Runner executes ScenarioPlan
9. After meaningful actions, Runner creates checkpoint
10. Runner uploads artifact to S3
11. Runner calls /internal/runner/runs/{runId}/checkpoints and /artifacts
12. Spring stores checkpoint/observation/artifact metadata
13. Runner calls finished/failed without embedding EvidencePacket
14. Spring materializes and stores EvidencePacket from checkpoint/observation/artifact rows
15. Spring creates analysis_job(evidence_packet_id=...) and publishes analysis.request with evidencePacketId
16. FastAPI Analyzer loads/receives the EvidencePacket through the Spring-owned analysis job context
17. Analyzer produces JudgeResult and calls completed/failed
18. Spring stores analysis_job, rule_hit, analysis_finding, nudge, report
19. React receives WebSocket events and renders report
```

## 4. Spring Package Structure

Recommended package structure:

```text
apps/api-server/
  src/main/java/com/wedge/
    WedgeApplication.java

    adapter/
      rest/
        project/
        run/
        report/
      internal/
        runner/
        analyzer/
      websocket/
      mcp/
      mq/

    application/
      project/
      run/
      scenario/
      evidence/
      analysis/
      report/
      agent/

    domain/
      project/
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

Rules:

- REST/MCP/Internal callback은 `application` service를 호출한다.
- domain package는 framework 의존성을 최소화한다.
- MyBatis mapper는 infrastructure에 둔다.
- 상태 전이 검증은 `application.run`에 둔다.
- DB write는 Spring service transaction 안에서 처리한다.

## 5. Node Runner Structure

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
      playwrightExecutor.ts
      actionHandlers/
      settleStrategies/
    collectors/
      checkpointCollector.ts
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
      springCallbackClient.ts
    artifacts/
      s3ArtifactClient.ts
    common/
      logger.ts
      errors.ts
```

## 6. FastAPI Analyzer Structure

```text
apps/analyzer/
  app/
    main.py
    api/
      health.py
      analyze.py
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

## 7. React Structure

```text
apps/web/
  src/
    app/                 # app bootstrap, providers, global styles
    pages/               # route-level orchestration only
      landing/
      RunCreatePage.tsx
      RunDetailPage.tsx
      ReportPage.tsx
    features/            # feature-owned UI/state/effects
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

## 8. Team Ownership

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
