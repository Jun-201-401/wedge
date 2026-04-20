# DDD Architecture Guide

이 문서는 DDD를 처음 보는 팀원이 Wedge의 폴더 구조를 이해하고, 새 코드를 어디에 둘지 판단할 수 있게 돕는 온보딩 문서다.

Wedge는 순수 이론형 DDD를 목표로 하지 않는다. 현재 목표는 **도메인별 패키지 경계가 있는 실용적 DDD-lite 구조**다.

여기서 DDD-lite는 DDD의 모든 이론을 엄격하게 적용한다는 뜻이 아니다. "업무 영역별로 코드를 나누고, 중요한 업무 규칙이 흩어지지 않게 한다"는 정도의 현실적인 기준이다.

```text
run/
  api/
  application/
  domain/
  infrastructure/
```

핵심은 "Controller냐 Service냐"보다 먼저 **이 코드가 어떤 업무 영역에 속하는가**를 판단하는 것이다.

처음 읽는다면 2장, 4장, 6장, 9장을 먼저 보면 된다. 나머지는 예시와 판단 기준을 더 자세히 풀어놓은 부분이다.

이 문서에서 자주 쓰는 말:

```text
use case
  사용자나 외부 시스템이 하려는 의미 있는 작업 하나.
  예: Run 시작, Run 중지, 분석 완료 반영.

callback
  외부 프로그램이 작업 결과나 상태를 다시 Spring 서버에 알려주는 요청.
  예: Runner가 "브라우저 실행이 끝났어"라고 알려주는 요청.

DTO
  API 요청/응답 모양을 표현하는 객체.
  예: RunCreateRequest, RunResponse.
```

---

## 1. DDD를 왜 쓰나

DDD는 Domain-Driven Design의 약자다. 한국어로는 도메인 주도 설계라고 부른다.

여기서 domain은 서비스가 해결하는 업무 문제 영역이다. Wedge에서는 다음 개념들이 도메인이다.

```text
auth
project
run
scenario
evidence
analysis
report
agent
```

DDD의 목적은 비즈니스 규칙과 제품 언어가 코드 구조에 드러나게 만드는 것이다.

예를 들어 Wedge에서 중요한 것은 단순히 "API 요청을 받아 DB에 저장한다"가 아니다. 중요한 업무 개념은 다음에 가깝다.

```text
Run을 생성한다
Run을 시작한다
Runner가 보낸 상태 알림 callback을 반영한다
Checkpoint evidence를 저장한다
EvidencePacket snapshot을 만든다
Analyzer에게 분석을 요청한다
JudgeResult를 사용자용 report로 만든다
```

이런 업무 흐름이 커질수록 전역 `controller/`, `service/`, `repository/` 구조만으로는 규칙의 위치가 흐려지기 쉽다.

---

## 2. MVC와 DDD는 경쟁 관계가 아니다

MVC는 주로 웹 요청 처리 구조다.

```text
Controller -> Service -> Repository -> DB
```

MVC의 질문은 보통 다음과 같다.

```text
이 파일은 Controller인가?
이 파일은 Service인가?
이 파일은 Repository인가?
```

MVC는 나쁜 구조가 아니다. 작은 CRUD 서비스라면 충분히 단순하고 빠르다.

문제는 Wedge처럼 업무 흐름이 길고, 여러 입구가 같은 규칙을 공유해야 하는 경우다.

여기서 "입구"는 서버에 요청이나 이벤트가 들어오는 경로를 말한다. 다음 세 가지가 다르면 다른 입구로 보면 된다.

```text
누가 보내는가?
어떤 주소나 메시지로 들어오는가?
무슨 일을 알려주거나 요청하는가?
```

예를 들어 Run 실행 상태를 바꾸는 주요 입구는 두 종류다.

```text
1. 사용자 화면 -> Public API

   사용자가 start 버튼을 누른다.
   브라우저가 Spring 서버의 `/api/runs/{runId}/start`로 요청한다.
   의미: "이 Run을 시작해줘."

2. Runner -> Internal Callback API

   Runner는 실제 브라우저 실행을 맡은 별도 프로그램이다.
   Runner가 Spring 서버의 `/internal/runner/runs/{runId}/accepted`로 callback을 보낸다.
   의미: "내가 이 Run 실행 요청을 받았어."

   Runner가 `/internal/runner/runs/{runId}/finished`로 callback을 보낸다.
   의미: "브라우저 실행이 끝났어."
```

사용자 화면과 Runner는 서로 다른 주체이고, 들어오는 주소도 다르다. 그래서 둘은 다른 입구다.

하지만 둘 다 결국 같은 `test_run.status`를 바꾼다. `test_run.status`는 DB에서 Run의 브라우저 실행 상태를 저장하는 컬럼이다.

```text
사용자 start 버튼
  -> /api/runs/{runId}/start
  -> Run을 CREATED에서 QUEUED로 바꾸고 싶다

Runner accepted callback
  -> /internal/runner/runs/{runId}/accepted
  -> Run을 QUEUED에서 STARTING으로 바꾸고 싶다

Runner finished callback
  -> /internal/runner/runs/{runId}/finished
  -> Run을 RUNNING에서 COMPLETED로 바꾸고 싶다
```

입구는 다르지만, 상태 변경이 가능한지는 같은 Run 상태표로 판단해야 한다.

여기서 "같은 규칙"은 이런 표를 말한다.

```text
CREATED  -> QUEUED 가능
QUEUED   -> STARTING 가능
STARTING -> RUNNING 가능
RUNNING  -> COMPLETED 가능
RUNNING  -> STOPPED 바로 변경 불가
FAILED   -> COMPLETED 변경 불가
```

중요한 점은 누가 요청했는지가 아니라, Run의 현재 상태에서 다음 상태로 넘어갈 수 있는지다.

Analyzer도 서버로 들어오는 별도 입구는 맞다. 다만 Analyzer callback은 보통 브라우저 실행 상태인 `test_run.status`가 아니라 분석 상태인 `analysis_status`를 바꾼다.

```text
Analyzer completed callback
  -> 예: /internal/analyzer/jobs/{analysisJobId}/completed
  -> analysis_status를 RUNNING에서 COMPLETED로 바꾸고 싶다
```

즉 "입구가 여러 개다"는 말은 사용자만 서버를 호출하는 것이 아니라 Runner, Analyzer, worker, MCP client 같은 외부 주체도 각자 다른 경로로 서버에 신호를 보낸다는 뜻이다. 그중 Run 실행 상태 예시에서는 사용자 화면과 Runner callback이 같은 상태 규칙을 공유한다.

그래서 Controller마다 직접 검사하지 않고, application 계층의 한 메서드로 모은다.

아래 코드는 실제 Java 구현 예시라기보다 흐름을 보여주는 의사코드다.

```java
class RunService {
    Run startRun(runId) {
        return changeStatus(runId, QUEUED);
    }

    Run markAccepted(runId) {
        return changeStatus(runId, STARTING);
    }

    Run finishRun(runId) {
        return changeStatus(runId, COMPLETED);
    }

    private Run changeStatus(runId, nextStatus) {
        Run run = runRepository.findById(runId);
        transitionPolicy.validate(run.status(), nextStatus);
        run.changeStatus(nextStatus);
        runRepository.save(run);
        return run;
    }
}
```

이 예시에서 Public API와 Runner callback은 서로 다른 입구다. 하지만 둘 다 상태 변경을 `RunService.changeStatus()`로 모으기 때문에 같은 상태표를 공유한다.

반대로 각 Controller가 직접 상태를 검사하면 이런 식으로 흩어진다.

```text
RunController
  - CREATED면 QUEUED로 바꿔도 된다고 직접 판단

RunnerCallbackController
  - QUEUED면 STARTING으로 바꿔도 된다고 직접 판단

AnalysisCallbackController
  - analysis_status가 RUNNING이면 COMPLETED로 바꿔도 된다고 직접 판단
```

이렇게 되면 상태 규칙을 바꿀 때 여러 파일을 찾아 고쳐야 한다. 한 곳을 놓치면 어떤 입구에서는 허용되고, 다른 입구에서는 거부되는 버그가 생긴다.

MVC만 전역 폴더로 밀고 가면 보통 이런 구조가 된다.

```text
controller/
  RunController.java
  RunnerCallbackController.java
  AnalyzerCallbackController.java

service/
  RunService.java
  EvidenceService.java
  AnalysisService.java
  ReportService.java

repository/
  RunRepository.java
  EvidenceRepository.java
  AnalysisRepository.java
```

처음에는 괜찮지만 기능이 늘면 다음 문제가 생기기 쉽다.

- `RunService`가 실행 상태, evidence, analysis, report, MQ publish까지 모두 알게 된다.
- 상태 전이 규칙이 Controller, Service, callback handler에 흩어진다.
- "Run을 시작한다"는 업무 흐름을 보려면 여러 전역 폴더를 오가야 한다.
- `service/` 폴더가 커질수록 어떤 Service가 어떤 도메인의 주인인지 흐려진다.
- HTTP API가 아닌 Runner callback, MCP, batch에서도 같은 규칙을 재사용하기 어렵다.
- DTO, DB entity, 업무 개념이 섞이기 쉽다.

DDD식 구조는 이 문제를 줄이기 위해 먼저 업무 경계를 세운다.

```text
run/
  api/
  application/
  domain/
  infrastructure/

evidence/
  api/
  application/
  domain/
  infrastructure/

analysis/
  api/
  application/
  domain/
  infrastructure/
```

이렇게 나누면 질문이 바뀐다.

```text
Run lifecycle 규칙인가? -> run
Checkpoint와 Observation 저장인가? -> evidence
Analyzer job과 JudgeResult 반영인가? -> analysis
Report 조회 결과와 공유인가? -> report
```

결과적으로 DDD식 구조는 Wedge에서 다음 장점이 있다.

- 같은 업무의 Controller, 작업 흐름, 규칙, DB 저장 코드가 가까운 위치에 모인다.
- HTTP, callback, MQ처럼 입구가 달라도 application/domain 계층의 규칙을 재사용하기 쉽다.
- 상태 전이, EvidencePacket 생성, JudgeResult 처리처럼 중요한 규칙의 위치가 명확해진다.
- 도메인별 담당자가 자기 영역을 찾기 쉽다.
- 새 기능을 만들 때 "어느 기술 폴더에 둘까"보다 "어느 업무 영역에 속할까"를 먼저 판단하게 된다.

DDD는 먼저 업무 영역을 묻는다.

```text
이 코드는 auth에 속하는가?
run에 속하는가?
evidence에 속하는가?
analysis에 속하는가?
```

그 다음 각 도메인 안에서 필요한 계층을 나눈다.

```text
run/
  api/              # HTTP 요청이 들어오는 입구
  application/      # 작업 흐름 조율
  domain/           # 업무 개념과 규칙
  infrastructure/   # DB 저장과 외부 시스템 연동
```

즉 DDD에서도 Controller는 존재한다. 다만 Controller는 최상위 주인공이 아니라 `run/api`처럼 외부 요청이 들어오는 입구에 둔다.

---

## 3. Wedge에서 권장하는 구조

백엔드는 도메인별로 아래 구조를 따른다.

```text
apps/api-server/src/main/java/com/wedge/
  run/
    api/
    application/
    domain/
    infrastructure/

  evidence/
    api/
    application/
    domain/
    infrastructure/

  analysis/
    api/
    application/
    domain/
    infrastructure/
```

프론트엔드는 DDD라고 부르기보다는 feature-sliced 구조에 가깝다.

```text
apps/web/src/
  pages/       # 화면 조립
  features/    # 기능별 component, hook, logic, style
  entities/    # 여러 feature에서 반복되는 안정적인 업무 모델
  shared/      # 반복 사용이 확인된 공용 코드
  api/         # HTTP client 경계
  websocket/   # 실시간 이벤트 수신 경계
```

백엔드와 프론트 모두 공통 원칙은 같다.

```text
기술 종류보다 제품/업무 경계를 먼저 본다.
```

---

## 4. 각 계층의 역할

### api

외부 세계와 만나는 입구다.

조금 더 쉽게 말하면 `api`는 번역기 역할을 한다.

```text
HTTP 요청 언어
  POST /api/runs/{runId}/start
  PathVariable, RequestBody, Header

        ↓

우리 서비스의 업무 언어
  runService.startRun(runId)
```

사용자는 HTTP로 말하고, application service는 `startRun`, `stopRun`, `createRun` 같은 업무 언어로 말한다. `api` 계층은 이 둘 사이를 연결한다.

주요 책임:

- HTTP route 정의
- request body, path variable, header 수신
- validation annotation 적용
- application service 호출
- response DTO와 HTTP status 구성

예시:

```text
apps/api-server/src/main/java/com/wedge/run/api/RunController.java
apps/api-server/src/main/java/com/wedge/run/api/dto/RunCreateRequest.java
apps/api-server/src/main/java/com/wedge/run/api/dto/RunResponse.java
```

`api`에 두면 좋은 코드:

```text
POST /api/runs 요청 DTO
GET /api/runs/{runId} 응답 DTO
Controller method
HTTP status 결정
```

`api`에 두면 안 좋은 코드:

```text
Run 상태 전이 규칙
DB update SQL
RabbitMQ publish 세부 구현
S3 upload 구현
```

Controller는 얇아야 한다. "요청을 받아 application에 넘긴다"가 핵심이다.

---

### application

사용자가 하려는 일을 시스템의 업무 절차로 실행하는 계층이다.

여기서 말하는 use case는 "사용자 또는 외부 시스템이 하려는 의미 있는 작업 하나"다.

예시:

```text
사용자 행위: Run 시작 버튼 클릭
use case: Run을 시작한다

사용자 행위: Run 중지 버튼 클릭
use case: 실행 중인 Run에 중지를 요청한다

Runner 행위: accepted callback 전송
use case: Runner가 실행 요청을 수락했음을 반영한다

Analyzer 행위: completed callback 전송
use case: 분석 결과를 저장하고 Report 조회 결과를 갱신한다
```

application 계층은 이 use case를 처리하기 위해 필요한 절차를 조율한다.

주요 책임:

- transaction 경계
- 권한 확인 조율
- 현재 상태 조회
- domain rule 호출
- 상태 변경
- repository/mapper 호출
- outbox 저장
- MQ/WebSocket/S3 같은 외부 작업 요청 조율

예시:

```text
apps/api-server/src/main/java/com/wedge/run/application/RunService.java
apps/api-server/src/main/java/com/wedge/run/application/RunStatusTransitionPolicy.java
```

Run 시작 use case를 풀어 쓰면 다음과 같다.

```text
1. runId로 Run을 조회한다.
2. Run이 존재하지 않으면 RUN_NOT_FOUND를 낸다.
3. 현재 상태가 시작 가능한지 확인한다.
4. status를 QUEUED로 바꾼다.
5. result_completeness를 NONE으로 둔다.
6. DB에 저장한다.
7. Runner 실행 요청 메시지를 outbox에 기록한다.
8. API 응답에 필요한 결과를 반환한다.
```

이 전체가 `RunService.startRun()` 같은 application method의 책임이다.

주의할 점:

- application은 비즈니스 흐름을 조율한다.
- 하지만 MyBatis XML, RabbitMQ client 세부 구현, S3 SDK 호출 방식 자체를 품으면 안 된다.
- 그런 기술 세부사항은 infrastructure로 보낸다.

---

### domain

Wedge의 업무 언어와 규칙을 담는 계층이다.

주요 책임:

- 도메인 상태
- 도메인 모델
- 값 객체
- 상태 전이 규칙
- 업무적으로 의미 있는 enum
- 특정 기술에 의존하지 않는 계산/판단

예시:

```text
apps/api-server/src/main/java/com/wedge/run/domain/RunStatus.java
apps/api-server/src/main/java/com/wedge/run/domain/ResultCompleteness.java
apps/api-server/src/main/java/com/wedge/run/domain/AnalysisStatus.java
```

Wedge에서 중요한 domain language 예시:

```text
RunStatus
ResultCompleteness
AnalysisStatus
ScenarioPlan
Checkpoint
Observation
EvidencePacket
RuleRegistry
JudgeResult
Nudge
Report
```

domain 계층은 가능하면 Spring, MyBatis, HTTP, RabbitMQ, S3를 몰라야 한다.

좋은 domain code 예시:

```java
public enum RunStatus {
    CREATED,
    QUEUED,
    STARTING,
    RUNNING,
    STOP_REQUESTED,
    STOPPED,
    COMPLETED,
    FAILED
}
```

나중에 도메인 모델이 더 커지면 이런 형태가 될 수 있다.

```java
public class Run {
    private RunStatus status;
    private ResultCompleteness resultCompleteness;

    public void start() {
        if (!RunStatusTransitionPolicy.canTransition(status, RunStatus.QUEUED)) {
            throw new StateConflictException();
        }

        this.status = RunStatus.QUEUED;
        this.resultCompleteness = ResultCompleteness.NONE;
    }
}
```

현재 프로젝트 문서에서는 상태 전이 검증을 `application.run`에 둔다고 정하고 있다. 따라서 `RunStatusTransitionPolicy`가 application에 있는 것은 현재 문서 기준으로 허용된다.

다만 규칙이 커지고 여러 use case에서 재사용되면 domain으로 옮기는 선택도 검토할 수 있다.

---

### infrastructure

기술 세부사항을 담는 계층이다.

주요 책임:

- MyBatis mapper
- DB 저장 구현
- RabbitMQ publisher
- S3 client
- OAuth/OIDC client
- 외부 API client
- WebSocket 구현체

예시:

```text
apps/api-server/src/main/java/com/wedge/auth/infrastructure/UserAccountMapper.java
apps/api-server/src/main/java/com/wedge/project/infrastructure/ProjectAccessMapper.java
apps/api-server/src/main/resources/mapper/auth/UserAccountMapper.xml
apps/api-server/src/main/resources/mapper/project/ProjectAccessMapper.xml
```

infrastructure는 "어떻게 저장하고 보낼 것인가"를 담당한다.

예시:

```text
RunRepository.save(run)
RunMapper.updateStatus(...)
RabbitRunPublisher.publish(...)
S3ArtifactStorage.upload(...)
```

infrastructure에 두면 안 좋은 코드:

```text
CREATED에서 COMPLETED로 바로 갈 수 있는지 판단
분석 실패와 브라우저 실행 실패를 같은 실패로 볼지 결정
EvidencePacket에 어떤 checkpoint가 필수인지 결정
Report에서 어떤 finding을 사용자에게 보여줄지 결정
```

이런 판단은 업무 규칙이므로 domain 또는 application에 있어야 한다.

---

## 5. 실제 요청 흐름 예시

사용자가 Run 시작 버튼을 누르면 HTTP 요청은 다음처럼 들어온다.

```http
POST /api/runs/{runId}/start
```

DDD식 흐름은 다음과 같다.

```text
run/api/RunController
  - HTTP 요청을 받는다.
  - runId를 꺼낸다.
  - runService.startRun(runId)를 호출한다.
  - 202 Accepted 응답을 만든다.

run/application/RunService
  - Run을 조회한다.
  - 현재 상태를 확인한다.
  - 상태 전이 규칙을 적용한다.
  - Run 상태를 QUEUED로 변경한다.
  - 저장을 요청한다.
  - Runner 실행 메시지 발행을 예약한다.

run/domain
  - RunStatus, ResultCompleteness 같은 업무 개념을 제공한다.
  - 상태 전이 가능 여부 같은 규칙을 제공한다.

run/infrastructure
  - DB update를 수행한다.
  - outbox row를 저장한다.
  - RabbitMQ 발행 구현을 담당한다.
```

이 흐름에서 Controller는 "Run 시작이 가능한가?"를 직접 판단하지 않는다. DB mapper도 "Run 시작이 가능한가?"를 판단하지 않는다.

업무 판단은 application/domain 쪽에 둔다.

---

## 6. 파일 위치 판단법

새 파일을 만들 때는 아래 질문을 순서대로 해본다.

### 1. 특정 도메인에 속하는가?

예:

```text
run 상태와 관련 있다 -> run/
EvidencePacket 저장과 관련 있다 -> evidence/
JudgeResult 처리와 관련 있다 -> analysis/
Report 공유와 관련 있다 -> report/
로그인/토큰과 관련 있다 -> auth/
```

여러 도메인에 걸쳐 보이면 먼저 use case의 주인을 정한다.

예:

```text
Runner callback이 checkpoint를 저장한다
```

이 경우 입구는 `internal/runner`일 수 있지만, 실제 업무 처리는 `run` 또는 `evidence` application service가 맡는다.

### 2. HTTP 입구인가?

그렇다면 `api/`다.

```text
Controller
Request DTO
Response DTO
```

### 3. 사용자의 작업 하나를 처리하는 흐름인가?

그렇다면 `application/`이다.

```text
createRun
startRun
stopRun
markRunnerAccepted
storeCheckpoint
completeAnalysis
shareReport
```

### 4. 업무 개념 또는 규칙 자체인가?

그렇다면 `domain/`이다.

```text
RunStatus
ResultCompleteness
EvidencePacket
ObservationType
RuleSeverity
ReportVisibility
```

### 5. DB/MQ/S3/외부 API 때문에 필요한가?

그렇다면 `infrastructure/`다.

```text
Mapper
Repository implementation
RabbitMQ publisher
S3 storage client
OAuth client
```

---

## 7. 흔한 실수

### Controller가 똑똑해지는 것

나쁜 방향:

```java
@PostMapping("/{runId}/start")
public ResponseEntity<?> startRun(@PathVariable UUID runId) {
    Run run = mapper.findById(runId);
    if (run.status() != CREATED) {
        throw ...
    }
    mapper.updateStatus(runId, QUEUED);
    rabbitTemplate.convertAndSend(...);
    return ...
}
```

문제:

- HTTP layer가 업무 규칙을 가진다.
- 테스트가 어려워진다.
- internal callback, MCP, batch 등 다른 입구에서 같은 규칙을 재사용하기 어렵다.

좋은 방향:

```java
@PostMapping("/{runId}/start")
public ResponseEntity<?> startRun(@PathVariable UUID runId) {
    RunResponse run = runService.startRun(runId);
    return ApiResponse.accepted(...);
}
```

### Service가 모든 것을 다 아는 것

나쁜 방향:

```text
RunService가 auth, evidence, analysis, report, RabbitMQ, S3, SQL을 모두 직접 처리한다.
```

문제:

- 하나의 service가 너무 커진다.
- 도메인 경계가 무너진다.
- 변경 영향 범위가 커진다.

좋은 방향:

```text
RunService는 run 상태 흐름을 조율한다.
EvidenceService는 EvidencePacket 생성을 맡는다.
AnalysisService는 analyzer job과 result 반영을 맡는다.
ReportService는 report 조회 결과와 공유를 맡는다.
```

### DTO가 도메인 모델이 되는 것

현재 초기 골격 코드에서는 `RunResponse`에 상태 변경 보조 메서드가 일부 있다. 초기 구현에서는 빠르게 움직이기 위해 허용될 수 있다.

하지만 기능이 커지면 다음처럼 분리하는 것이 좋다.

```text
run/domain/Run.java
  - 상태와 규칙

run/api/dto/RunResponse.java
  - API 응답 모양
```

DTO는 외부 표현이고, 도메인 모델은 업무 개념이다.

---

## 8. Wedge에서의 현실적인 기준

Wedge는 일정과 팀 규모를 고려해 다음 수준을 목표로 한다.

해야 할 것:

- 도메인별 패키지를 유지한다.
- Controller는 얇게 둔다.
- use case는 application service에 둔다.
- DB/MQ/S3 구현은 infrastructure에 둔다.
- 공통 계약은 `packages/contracts`를 먼저 수정한다.
- 업무 payload와 전송 payload를 구분한다.

지나치게 하지 말 것:

- 모든 enum마다 과한 클래스를 만들기
- 단순 CRUD까지 억지로 복잡한 도메인 객체 묶음으로 감싸기
- 아직 반복되지 않은 코드를 shared/common으로 먼저 빼기
- 저장소 인터페이스를 무조건 만들기
- 순수 DDD 용어에 맞추려고 현재 문서 결정과 다른 구조 만들기

현재 목표는 다음이다.

```text
작게 시작하되, 도메인 경계가 무너지지 않게 만든다.
```

---

## 9. 빠른 요약

```text
api
  외부 요청/응답. Controller, request DTO, response DTO.

application
  use case 실행. 트랜잭션, 권한/상태/저장/메시지 조율.

domain
  업무 개념과 규칙. 상태, 값, 정책, 도메인 모델.

infrastructure
  기술 구현. DB, MyBatis, MQ, S3, 외부 API.
```

파일 위치가 헷갈리면 이렇게 물어본다.

```text
이 코드는 HTTP 때문에 필요한가? -> api
이 코드는 사용자/외부 시스템의 작업 하나를 처리하는가? -> application
이 코드는 업무 규칙이나 상태 자체인가? -> domain
이 코드는 DB/MQ/S3/외부 API 때문에 필요한가? -> infrastructure
```

Wedge에서는 MVC를 버리는 것이 아니라, MVC의 Controller를 도메인별 `api` 계층 안에 둔다. 전체 구조의 기준은 기술 계층이 아니라 업무 도메인이다.
