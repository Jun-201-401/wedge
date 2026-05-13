# Jenkins Baseline

이 디렉토리는 EC2 내부 Docker 컨테이너 Jenkins 기준선을 정의한다.

## 목표

- Jenkins UI는 EC2 외부에 직접 공개하지 않는다.
- Jenkins는 `127.0.0.1:18081` 에만 바인딩한다.
- 로컬 PC에서는 SSH 터널로 Jenkins UI에 접속한다.
- Jenkins는 EC2 호스트에 SSH로 접속해 운영 배포를 수행한다.
- 운영 app 컨테이너 이미지는 Jenkins가 생성한 release env 파일 기준으로만 갱신한다.

## 구성 요소

- [Dockerfile](Dockerfile)
  - 공식 `jenkins/jenkins` LTS 이미지를 기반으로 `curl`, `openssh-client`만 추가한다.
- [plugins.txt](plugins.txt)
  - Pipeline, Git, credentials, webhook 처리에 필요한 최소 플러그인만 포함한다.
- [compose.jenkins.yaml](/C:/Users/SSAFY/Documents/SSAFY/WorkSpace/Project/Wedge/S14P31C104/compose.jenkins.yaml)
  - Jenkins 컨테이너만 실행한다.

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

## 배포 원칙

운영 배포에서 `/srv/wedge`의 Git HEAD는 배포 완료 상태가 아니다.
실제 배포 완료 상태는 Jenkins가 검증 후 승격한 `.deploy/current.env`가 기준이다.

- Jenkins는 배포 대상 commit SHA로 app 이미지를 빌드한다.
- Jenkins는 `.deploy/candidate-<sha>.env`로 새 컨테이너를 띄운다.
- 이미지 검증과 health check가 성공한 뒤에만 `.deploy/current.env`로 승격한다.
- 수동 운영 compose 명령은 `bash infra/scripts/prod-compose.sh ...`를 사용한다.

예:

```bash
cd /srv/wedge
bash infra/scripts/prod-compose.sh ps
bash infra/scripts/prod-compose.sh up -d --force-recreate web
```
