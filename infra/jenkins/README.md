# Jenkins Baseline

이 디렉토리는 EC2 내부 Docker 컨테이너 Jenkins 기준선을 정의한다.

## 목표

- Jenkins UI는 EC2 외부에 직접 공개하지 않는다.
- Jenkins는 `127.0.0.1:18081` 에만 바인딩한다.
- 로컬 PC에서는 SSH 터널로 Jenkins UI에 접속한다.
- Jenkins는 `api-server` 기준 base CI build 를 수행한다.

## 구성 요소

- [Dockerfile](Dockerfile)
  - 공식 `jenkins/jenkins` LTS 이미지를 기반으로 Docker CLI 를 추가한다.
- [plugins.txt](plugins.txt)
  - Pipeline, Git, Docker build 에 필요한 최소 플러그인만 포함한다.
- [compose.jenkins.yaml](/C:/Users/SSAFY/Documents/SSAFY/WorkSpace/Project/Wedge/S14P31C104/compose.jenkins.yaml)
  - `docker:dind` 와 Jenkins 컨테이너를 함께 실행한다.

## EC2 실행

```bash
cd /srv/wedge
docker compose -f compose.jenkins.yaml build
docker compose -f compose.jenkins.yaml up -d
```

## 초기 관리자 비밀번호 확인

```bash
docker compose -f compose.jenkins.yaml exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

## 로컬 PC 에서 SSH 터널 접속

```bash
ssh -i K14C104T.pem -L 18081:127.0.0.1:18081 ubuntu@k14c104.p.ssafy.io
```

브라우저 접속:

```text
http://localhost:18081
```

## 현재 범위

현재 Jenkins baseline 목표는 아래까지만 포함한다.

- GitLab 저장소 checkout
- `apps/api-server` Gradle build
- `apps/api-server` Docker image build

운영 배포(CD) 연계는 별도 스토리에서 진행한다.
