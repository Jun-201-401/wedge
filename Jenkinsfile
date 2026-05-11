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
            defaultValue: false,
            description: 'Run Flyway info and migrate before application deploy. Enable only after the one-time production baseline is complete.'
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
        IMAGE_NAME = 'wedge-api-server'
        WEB_IMAGE_NAME = 'wedge-web'
        RUNNER_IMAGE_NAME = 'wedge-runner'
        ANALYZER_IMAGE_NAME = 'wedge-analyzer'
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
                }
            }
        }

        stage('Docker Info') {
            steps {
                script {
                    env.FAILED_STAGE = 'Docker Info'
                    runLogged('docker version')
                }
            }
        }

        stage('Build Images') {
            steps {
                script {
                    env.FAILED_STAGE = 'Build Images'
                    runLogged('''
docker build -f apps/api-server/Dockerfile -t "${IMAGE_NAME}:ci-${BUILD_NUMBER}" apps/api-server
docker build -f apps/web/Dockerfile -t "${WEB_IMAGE_NAME}:ci-${BUILD_NUMBER}" apps/web
docker build -f apps/runner/Dockerfile -t "${RUNNER_IMAGE_NAME}:ci-${BUILD_NUMBER}" .
docker build -f apps/analyzer/Dockerfile -t "${ANALYZER_IMAGE_NAME}:ci-${BUILD_NUMBER}" .
                    ''')
                }
            }
        }

        stage('Database Migration') {
            when {
                expression {
                    return params.RUN_DB_MIGRATION == true
                }
            }
            steps {
                script {
                    env.FAILED_STAGE = 'Database Migration'
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

ssh -i "$EC2_KEY" $SSH_OPTS "$EC2_USER@$DEPLOY_HOST" "GIT_AUTH_HEADER='$GIT_AUTH_HEADER' GIT_URL='$GIT_URL' GIT_BRANCH='$GIT_BRANCH' bash -s" << 'EOF'
set -e

cd /srv/wedge

git remote set-url origin "$GIT_URL"
git remote set-url --push origin "$GIT_URL"
git -c credential.helper= -c "http.extraHeader=Authorization: Basic ${GIT_AUTH_HEADER}" fetch --prune origin "$GIT_BRANCH"
unset GIT_AUTH_HEADER
git reset --hard "origin/$GIT_BRANCH"

docker compose --env-file .env.prod -f compose.prod.yaml up -d postgres
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway info
docker compose --env-file .env.prod -f compose.prod.yaml --profile migration run --rm flyway migrate
EOF
                        ''')
                    }
                }
            }
        }

        stage('Deploy to EC2') {
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

ssh -i "$EC2_KEY" $SSH_OPTS "$EC2_USER@$DEPLOY_HOST" "GIT_AUTH_HEADER='$GIT_AUTH_HEADER' GIT_URL='$GIT_URL' GIT_BRANCH='$GIT_BRANCH' bash -s" << 'EOF'
set -e

cd /srv/wedge

PREVIOUS_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
git remote set-url origin "$GIT_URL"
git remote set-url --push origin "$GIT_URL"
git -c credential.helper= -c "http.extraHeader=Authorization: Basic ${GIT_AUTH_HEADER}" fetch --prune origin "$GIT_BRANCH"
unset GIT_AUTH_HEADER
git reset --hard "origin/$GIT_BRANCH"
CURRENT_HEAD="$(git rev-parse HEAD)"
RABBITMQ_RECREATE_REQUIRED=false
if [ -z "$PREVIOUS_HEAD" ] || git diff --name-only "$PREVIOUS_HEAD" "$CURRENT_HEAD" -- compose.prod.yaml infra/rabbitmq/rabbitmq-prod.conf infra/rabbitmq/rabbitmq-definitions-prod.json | grep -q .; then
    RABBITMQ_RECREATE_REQUIRED=true
fi

docker build -f apps/api-server/Dockerfile -t wedge-api-server:deploy-local apps/api-server
docker build -f apps/web/Dockerfile -t wedge-web:deploy-local apps/web
docker build -f apps/runner/Dockerfile -t wedge-runner:deploy-local .
docker build -f apps/analyzer/Dockerfile -t wedge-analyzer:deploy-local .

wait_for_rabbitmq() {
    local attempts="${1:-60}"
    local delay_seconds="${2:-2}"
    local attempt

    for attempt in $(seq 1 "$attempts"); do
        if docker compose --env-file .env.prod -f compose.prod.yaml exec -T rabbitmq rabbitmqctl await_startup --timeout 5 > /dev/null 2>&1 \
            && docker compose --env-file .env.prod -f compose.prod.yaml exec -T rabbitmq rabbitmq-diagnostics -q ping > /dev/null 2>&1; then
            return 0
        fi

        echo "Waiting for RabbitMQ startup... (${attempt}/${attempts})"
        sleep "$delay_seconds"
    done

    docker compose --env-file .env.prod -f compose.prod.yaml logs --tail=100 rabbitmq
    return 1
}

if [ "$RABBITMQ_RECREATE_REQUIRED" = "true" ] && docker compose --env-file .env.prod -f compose.prod.yaml ps --status running --services rabbitmq | grep -qx rabbitmq; then
    mkdir -p backups/rabbitmq
    RABBITMQ_BACKUP_FILE="rabbitmq-definitions-$(date -u +%Y%m%dT%H%M%SZ).json"
    docker compose --env-file .env.prod -f compose.prod.yaml exec -T rabbitmq rabbitmqctl export_definitions "/tmp/${RABBITMQ_BACKUP_FILE}"
    docker compose --env-file .env.prod -f compose.prod.yaml cp "rabbitmq:/tmp/${RABBITMQ_BACKUP_FILE}" "backups/rabbitmq/${RABBITMQ_BACKUP_FILE}"
fi
if [ "$RABBITMQ_RECREATE_REQUIRED" = "true" ]; then
    docker compose --env-file .env.prod -f compose.prod.yaml up -d --force-recreate rabbitmq
else
    docker compose --env-file .env.prod -f compose.prod.yaml up -d rabbitmq
fi
wait_for_rabbitmq 90 2
bash infra/rabbitmq/provision-prod-user.sh
docker compose --env-file .env.prod -f compose.prod.yaml up -d api-server web runner analyzer-worker
docker compose --env-file .env.prod -f compose.prod.yaml up -d --force-recreate nginx

for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -kfsS https://localhost/actuator/health > /dev/null 2>&1 \
        && curl -kfsS https://localhost/ > /dev/null 2>&1 \
        && docker compose --env-file .env.prod -f compose.prod.yaml ps --status running --services runner | grep -qx runner \
        && docker compose --env-file .env.prod -f compose.prod.yaml ps --status running --services analyzer-worker | grep -qx analyzer-worker; then
        echo "Health check passed"
        exit 0
    fi

    echo "Waiting for web, api-server, runner, and analyzer-worker health..."
    sleep 3
done

echo "Health check failed"
docker compose --env-file .env.prod -f compose.prod.yaml logs --tail=100 rabbitmq api-server web runner analyzer-worker nginx
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
