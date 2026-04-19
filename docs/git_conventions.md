# Git Conventions

## 목적
이 문서는 Wedge 저장소에서 공통으로 따를 Git 협업 규칙을 정의한다. 목표는 히스토리, PR 리뷰, 롤백 흐름을 읽기 쉽게 유지하는 것이다.

## 브랜치 네이밍
브랜치는 작업 의도가 바로 보이게 짓는다.

- `feature/run-create-api`
- `fix/runner-callback-duplication`
- `refactor/contracts-layout`
- `docs/api-spec-cleanup`

권장 prefix:
- `feature/`
- `fix/`
- `refactor/`
- `docs/`
- `chore/`
- `test/`

## 커밋 메시지
이 저장소는 `Conventional Commits` 제목과 `Lore-style trailer`를 함께 사용한다. 제목 prefix는 영어(`feat:`, `fix:`)로 유지하고, 제목 내용과 본문은 한글로 작성한다. 한 커밋에는 한 가지 의도만 담는다.

예:
- `feat: run 생성 뼈대 추가`
- `fix: 중복 callback 처리 방지`
- `refactor: websocket 이벤트 스키마 분리`
- `docs: OpenAPI 위치 기준 명확화`

권장 타입:
- `feat`
- `fix`
- `refactor`
- `docs`
- `test`
- `chore`
- `build`
- `ci`

제목 아래에는 Lore-style trailer를 붙여 의사결정과 검증 기록을 남긴다.

```text
feat: 공통 계약 구조 정리

Constraint: Contracts must stay readable by all services
Rejected: Keep OpenAPI under docs | mixes prose and machine-readable assets
Confidence: high
Scope-risk: narrow
Tested: JSON schema parsing, Gradle test
Not-tested: Runtime integration between services
```

## 커밋 단위
- 기능 추가, 리팩터링, 문서 수정은 가능한 한 분리한다.
- 대규모 이동 작업과 동작 변경을 한 커밋에 섞지 않는다.
- 계약 변경이 있으면 구현보다 먼저 커밋하거나, 같은 커밋에서 명확히 설명한다.

## PR 규칙
PR에는 아래 내용을 포함한다.

- 변경 목적
- 영향 받는 영역 (`api-server`, `web`, `runner`, `analyzer`, `contracts`, `docs`)
- 검증 방법과 실행한 명령
- 계약 변경 여부
- UI 변경 시 스크린샷

PR 제목도 같은 규칙을 따른다. 예: `feat: run monitor 화면 골격 추가`

## 병합 원칙
- 리뷰 가능한 작은 PR을 우선한다.
- rebase 또는 squash 후 병합해 히스토리를 정리한다.
- 실패한 실험용 커밋은 브랜치에서 정리하고 main 계열에는 남기지 않는다.
