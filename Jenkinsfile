def runLogged(String scriptText) {
    sh """#!/bin/bash
set -euo pipefail
{
${scriptText}
} 2>&1 | tee -a "${env.WORKSPACE}/${env.LOG_FILE}"
"""
}

def sendMMNotify(boolean success, Map info) {
    try {
        def action = info.action ?: 'Build'
        def service = info.service ? "[${info.service}] " : ''
        def emoji = success ? ':jenkins7:' : ':angry_jenkins:'
        def statusMsg = success ? '성공 ✅' : '실패 ❌'
        def color = success ? '#36a64f' : '#dc3545'

        def mainText = "### ${emoji} ${service}Wedge ${action} ${statusMsg}\n"
        def links = []
        if (info.mention) {
            links << "${info.mention}"
        }
        if (info.buildUrl) {
            links << "[빌드 결과 확인](${info.buildUrl})"
        }
        mainText += links.join(' ｜ ')

        def fields = []
        if (info.branch) {
            fields << [short: false, title: 'Branch', value: "`${info.branch}`"]
        }
        if (info.commit) {
            fields << [short: false, title: 'Commit', value: info.commit]
        }

        def buildValue = "`${env.BUILD_NUMBER}`"
        if (info.duration) {
            buildValue += " · ${info.duration}"
        }
        fields << [short: !success, title: 'Build', value: buildValue]

        if (!success && info.failedStage) {
            fields << [short: true, title: 'Failed Stage', value: "`${info.failedStage}`"]
        }

        def attachments = [[
            color : color,
            fields: fields
        ]]

        if (!success && info.details) {
            attachments << [
                color: color,
                text : "**Error Log:**\n```text\n${info.details}\n```"
            ]
        }

        def payload = [
            username   : 'Jenkins',
            icon_emoji : emoji,
            text       : mainText,
            attachments: attachments
        ]

        writeFile file: 'mattermost-payload.json', text: groovy.json.JsonOutput.toJson(payload)

        withCredentials([string(credentialsId: 'mattermost-webhook', variable: 'MM_WEBHOOK')]) {
            sh '''
set +x
curl -fsS --max-time 10 -H 'Content-Type: application/json' \
  --data-binary @mattermost-payload.json \
  "$MM_WEBHOOK" || true
'''
        }
    } catch (err) {
        echo "Mattermost notify failed: ${err}"
    }
}

pipeline {
    agent any

    options {
        disableConcurrentBuilds()
    }

    parameters {
        booleanParam(
            name: 'RUN_DB_MIGRATION',
            defaultValue: true,
            description: 'Run Flyway info and migrate when infra/db/migrations changes. Set false only to intentionally block DB migration.'
        )
    }

    triggers {
        GenericTrigger(
            genericVariables: [
                [key: 'ref', value: '$.ref']
            ],
            causeString: 'Triggered by GitLab webhook: $ref',
            tokenCredentialId: 'gitlab-webhook-token',
            printContributedVariables: false,
            printPostContent: false,
            shouldNotFlatten: false,
            regexpFilterText: '$ref',
            regexpFilterExpression: '^refs/heads/develop$'
        )
    }

    environment {
        GIT_URL = 'https://lab.ssafy.com/s14-final/S14P31C104.git'
        GIT_BRANCH = 'develop'
        DEPLOY_HOST = 'k14c104.p.ssafy.io'
        SSH_OPTS = '-o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/jenkins_home/.ssh/known_hosts -o UpdateHostKeys=no'
        LOG_FILE = 'jenkins-console.log'
    }

    stages {
        stage('Init') {
            steps {
                script {
                    env.FAILED_STAGE = 'Init'
                    env.COMMIT_MSG = ''
                    env.MIGRATION_FILES_CHANGED = 'false'
                }
                writeFile file: env.LOG_FILE, text: ''
            }
        }

        stage('Checkout') {
            steps {
                script {
                    env.FAILED_STAGE = 'Checkout'
                }
                git branch: "${GIT_BRANCH}",
                    credentialsId: 'gitlab-https',
                    url: "${GIT_URL}"
                script {
                    env.COMMIT_MSG = sh(script: 'git log -1 --pretty=%s', returnStdout: true).trim()
                    env.MIGRATION_FILES_CHANGED = sh(script: '''
if git rev-parse --verify HEAD^ >/dev/null 2>&1 \
    && git diff --name-only HEAD^ HEAD -- infra/db/migrations | grep -q .; then
    echo true
else
    echo false
fi
''', returnStdout: true).trim()
                }
            }
        }

        stage('Deploy to EC2') {
            options {
                timeout(time: 30, unit: 'MINUTES')
            }
            steps {
                script {
                    env.FAILED_STAGE = 'Deploy to EC2'
                }
                withCredentials([sshUserPrivateKey(
                    credentialsId: 'ec2-ssh',
                    keyFileVariable: 'EC2_KEY',
                    usernameVariable: 'EC2_USER'
                ), usernamePassword(
                    credentialsId: 'gitlab-ec2-readonly',
                    usernameVariable: 'GITLAB_RO_USER',
                    passwordVariable: 'GITLAB_RO_TOKEN'
                )]) {
                    script {
                        runLogged('''
set -e

GIT_AUTH_HEADER="$(printf '%s:%s' "$GITLAB_RO_USER" "$GITLAB_RO_TOKEN" | base64 | tr -d '\n')"

ssh -i "$EC2_KEY" $SSH_OPTS "$EC2_USER@$DEPLOY_HOST" "GIT_AUTH_HEADER='$GIT_AUTH_HEADER' GIT_URL='$GIT_URL' GIT_BRANCH='$GIT_BRANCH' MIGRATION_FILES_CHANGED='${MIGRATION_FILES_CHANGED:-false}' RUN_DB_MIGRATION='${RUN_DB_MIGRATION:-false}' bash -lc 'cat > /tmp/wedge-jenkins-deploy-${BUILD_NUMBER}.sh && trap \"rm -f /tmp/wedge-jenkins-deploy-${BUILD_NUMBER}.sh\" EXIT && bash /tmp/wedge-jenkins-deploy-${BUILD_NUMBER}.sh'" << 'EOF'
set -e

cd /srv/wedge

PREVIOUS_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
git remote set-url origin "$GIT_URL"
git remote set-url --push origin "$GIT_URL"
git -c credential.helper= -c "http.extraHeader=Authorization: Basic ${GIT_AUTH_HEADER}" fetch --prune origin "$GIT_BRANCH"
unset GIT_AUTH_HEADER
git reset --hard "origin/$GIT_BRANCH"
CURRENT_HEAD="$(git rev-parse HEAD)"
API_SERVER_IMAGE="wedge-api-server:${CURRENT_HEAD}"
WEB_IMAGE="wedge-web:${CURRENT_HEAD}"
RUNNER_IMAGE="wedge-runner:${CURRENT_HEAD}"
ANALYZER_IMAGE="wedge-analyzer:${CURRENT_HEAD}"
RABBITMQ_RECREATE_REQUIRED=false
if [ -z "$PREVIOUS_HEAD" ] || git diff --name-only "$PREVIOUS_HEAD" "$CURRENT_HEAD" -- compose.prod.yaml infra/rabbitmq/rabbitmq-prod.conf infra/rabbitmq/rabbitmq-definitions-prod.json | grep -q .; then
    RABBITMQ_RECREATE_REQUIRED=true
fi

mkdir -p .deploy
CANDIDATE_RELEASE_ENV=".deploy/candidate-${CURRENT_HEAD}.env"
CURRENT_RELEASE_ENV=".deploy/current.env"

cat > "$CANDIDATE_RELEASE_ENV" << RELEASE_ENV
WEDGE_RELEASE_GIT_SHA=${CURRENT_HEAD}
API_SERVER_IMAGE=${API_SERVER_IMAGE}
WEB_IMAGE=${WEB_IMAGE}
RUNNER_IMAGE=${RUNNER_IMAGE}
ANALYZER_IMAGE=${ANALYZER_IMAGE}
RELEASE_ENV

compose_prod() {
    bash infra/scripts/prod-compose.sh --release-env "$CANDIDATE_RELEASE_ENV" "$@"
}

if [ "${MIGRATION_FILES_CHANGED:-false}" = "true" ] && [ "${RUN_DB_MIGRATION:-false}" != "true" ]; then
    echo "Migration files changed but RUN_DB_MIGRATION=false. Enable migration or review the deployment."
    exit 1
fi

docker build -f apps/api-server/Dockerfile -t "$API_SERVER_IMAGE" apps/api-server
docker build -f apps/web/Dockerfile -t "$WEB_IMAGE" apps/web
docker build -f apps/runner/Dockerfile -t "$RUNNER_IMAGE" .
docker build -f apps/analyzer/Dockerfile -t "$ANALYZER_IMAGE" .

wait_for_rabbitmq() {
    local attempts="${1:-60}"
    local delay_seconds="${2:-2}"
    local attempt

    for attempt in $(seq 1 "$attempts"); do
        if compose_prod exec -T rabbitmq rabbitmqctl await_startup --timeout 5 > /dev/null 2>&1 \
            && compose_prod exec -T rabbitmq rabbitmq-diagnostics -q ping > /dev/null 2>&1; then
            return 0
        fi

        echo "Waiting for RabbitMQ startup... (${attempt}/${attempts})"
        sleep "$delay_seconds"
    done

    compose_prod logs --tail=100 rabbitmq
    return 1
}

backup_rabbitmq_definitions() {
    if compose_prod ps --status running --services rabbitmq | grep -qx rabbitmq; then
        mkdir -p backups/rabbitmq
        RABBITMQ_BACKUP_FILE="rabbitmq-definitions-$(date -u +%Y%m%dT%H%M%SZ).json"
        compose_prod exec -T rabbitmq rabbitmqctl export_definitions "/tmp/${RABBITMQ_BACKUP_FILE}"
        compose_prod cp "rabbitmq:/tmp/${RABBITMQ_BACKUP_FILE}" "backups/rabbitmq/${RABBITMQ_BACKUP_FILE}"
    fi
}

start_rabbitmq() {
    local force_recreate="${1:-false}"

    if [ "$force_recreate" = "true" ]; then
        backup_rabbitmq_definitions
        compose_prod up -d --force-recreate rabbitmq
    else
        compose_prod up -d rabbitmq
    fi

    wait_for_rabbitmq 90 2
    RELEASE_ENV_FILE="$CANDIDATE_RELEASE_ENV" bash infra/rabbitmq/provision-prod-user.sh
}

verify_rabbitmq_topology() {
    local expected_definitions="infra/rabbitmq/rabbitmq-definitions-prod.json"
    local actual_definitions

    actual_definitions="$(mktemp)"

    compose_prod exec -T rabbitmq rabbitmqctl export_definitions /tmp/rabbitmq-current-definitions.json > /dev/null
    compose_prod exec -T rabbitmq cat /tmp/rabbitmq-current-definitions.json > "$actual_definitions"

    if ! python3 - "$expected_definitions" "$actual_definitions" << 'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    expected = json.load(source)
with open(sys.argv[2], encoding="utf-8") as source:
    actual = json.load(source)

missing = []

actual_queues = {
    (queue.get("vhost", "/"), queue.get("name", "")): queue.get("arguments") or {}
    for queue in actual.get("queues", [])
}
for queue in expected.get("queues", []):
    key = (queue.get("vhost", "/"), queue.get("name", ""))
    actual_arguments = actual_queues.get(key)
    if actual_arguments is None:
        missing.append(f"queue {key[0]} {key[1]}")
        continue
    for argument_name, expected_value in (queue.get("arguments") or {}).items():
        if actual_arguments.get(argument_name) != expected_value:
            missing.append(f"queue-argument {key[0]} {key[1]} {argument_name}={expected_value}")

actual_bindings = actual.get("bindings", [])
for binding in expected.get("bindings", []):
    if binding.get("destination_type") != "queue":
        continue
    expected_arguments = binding.get("arguments") or {}
    match = None
    for actual_binding in actual_bindings:
        if (
            actual_binding.get("vhost", "/") == binding.get("vhost", "/")
            and actual_binding.get("source", "") == binding.get("source", "")
            and actual_binding.get("destination_type", "") == binding.get("destination_type", "")
            and actual_binding.get("destination", "") == binding.get("destination", "")
            and actual_binding.get("routing_key", "") == binding.get("routing_key", "")
        ):
            match = actual_binding
            break
    if match is None:
        missing.append(
            "binding "
            f"{binding.get('vhost', '/')} "
            f"{binding.get('source', '')} "
            f"{binding.get('destination', '')} "
            f"{binding.get('routing_key', '')}"
        )
        continue
    actual_arguments = match.get("arguments") or {}
    for argument_name, expected_value in expected_arguments.items():
        if actual_arguments.get(argument_name) != expected_value:
            missing.append(
                "binding-argument "
                f"{binding.get('vhost', '/')} "
                f"{binding.get('source', '')} "
                f"{binding.get('destination', '')} "
                f"{binding.get('routing_key', '')} "
                f"{argument_name}={expected_value}"
            )

if missing:
    print("RabbitMQ topology mismatch. Missing expected topology entries:")
    for entry in missing:
        print(entry)
    sys.exit(1)
PY
    then
        rm -f "$actual_definitions"
        return 1
    fi

    rm -f "$actual_definitions"
    echo "RabbitMQ topology verified against ${expected_definitions}"
}

verify_service_image() {
    local service="$1"
    local expected_image="$2"
    local container_id
    local actual_image

    container_id="$(compose_prod ps -q "$service")"
    if [ -z "$container_id" ]; then
        echo "Container not found for service: ${service}"
        return 1
    fi

    actual_image="$(docker inspect "$container_id" --format '{{.Config.Image}}')"
    if [ "$actual_image" != "$expected_image" ]; then
        echo "Unexpected image for ${service}: expected=${expected_image}, actual=${actual_image}"
        return 1
    fi
}

start_rabbitmq "$RABBITMQ_RECREATE_REQUIRED"
if ! verify_rabbitmq_topology; then
    echo "RabbitMQ topology does not match the production definitions. Recreating RabbitMQ once..."
    start_rabbitmq true
    verify_rabbitmq_topology
fi

compose_prod up -d postgres redis
if [ "${MIGRATION_FILES_CHANGED:-false}" = "true" ]; then
    compose_prod --profile migration run --rm flyway info
    compose_prod --profile migration run --rm flyway migrate
fi

compose_prod up -d --no-deps --force-recreate api-server web runner analyzer-worker
compose_prod up -d --force-recreate nginx
verify_service_image api-server "$API_SERVER_IMAGE"
verify_service_image web "$WEB_IMAGE"
verify_service_image runner "$RUNNER_IMAGE"
verify_service_image analyzer-worker "$ANALYZER_IMAGE"

for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -kfsS https://localhost/actuator/health > /dev/null 2>&1 \
        && curl -kfsS https://localhost/ > /dev/null 2>&1 \
        && compose_prod ps --status running --services runner | grep -qx runner \
        && compose_prod ps --status running --services analyzer-worker | grep -qx analyzer-worker; then
        mv "$CANDIDATE_RELEASE_ENV" "$CURRENT_RELEASE_ENV"
        printf '%s\n' "$CURRENT_HEAD" > .deploy/current.sha
        echo "Health check passed"
        exit 0
    fi

    echo "Waiting for web, api-server, runner, and analyzer-worker health..."
    sleep 3
done

echo "Health check failed"
compose_prod logs --tail=100 rabbitmq api-server web runner analyzer-worker nginx
exit 1
EOF
                        ''')
                    }
                }
            }
        }
    }

    post {
        success {
            script {
                def duration = currentBuild.durationString.replace(' and counting', '')
                sendMMNotify(true, [
                    branch  : env.GIT_BRANCH,
                    commit  : env.COMMIT_MSG ?: '',
                    duration: duration,
                    action  : 'Deploy',
                    buildUrl: env.BUILD_URL
                ])
            }
        }

        failure {
            script {
                def duration = currentBuild.durationString.replace(' and counting', '')
                def details = ''

                try {
                    details = readFile(file: env.LOG_FILE).trim()
                    if (details.length() > 8000) {
                        details = details.substring(details.length() - 8000)
                    }
                } catch (err) {
                    details = "Error log collection failed: ${err}"
                }

                sendMMNotify(false, [
                    mention    : '@here',
                    branch     : env.GIT_BRANCH,
                    commit     : env.COMMIT_MSG ?: '',
                    duration   : duration,
                    action     : 'Deploy',
                    failedStage: env.FAILED_STAGE ?: 'unknown',
                    details    : details,
                    buildUrl   : env.BUILD_URL
                ])
            }
        }

        cleanup {
            deleteDir()
        }
    }
}
