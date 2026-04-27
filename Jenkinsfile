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
        def emoji = success ? ':jenkins7:' : ':angry_jenkins:'
        def statusMsg = success ? '성공 ✅' : '실패 ❌'
        def color = success ? '#36a64f' : '#dc3545'

        def mainText = "### ${emoji} Wedge ${action} ${statusMsg}\n"
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

        stage('Build Image') {
            steps {
                script {
                    env.FAILED_STAGE = 'Build Image'
                    runLogged('docker build -f apps/api-server/Dockerfile -t "${IMAGE_NAME}:ci-${BUILD_NUMBER}" apps/api-server')
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
                )]) {
                    script {
                        runLogged('''
set -e

tar \
  --exclude=.git \
  --exclude=.gradle \
  --exclude=apps/api-server/build \
  --exclude=apps/runner/node_modules \
  -czf /tmp/wedge-deploy.tar.gz .

scp -i "$EC2_KEY" $SSH_OPTS /tmp/wedge-deploy.tar.gz "$EC2_USER@$DEPLOY_HOST:/tmp/wedge-deploy.tar.gz"

ssh -i "$EC2_KEY" $SSH_OPTS "$EC2_USER@$DEPLOY_HOST" 'bash -s' << 'EOF'
set -e

cd /srv/wedge

tar \
  --exclude=.env.prod \
  -xzf /tmp/wedge-deploy.tar.gz -C /srv/wedge

docker build -f apps/api-server/Dockerfile -t wedge-api-server:deploy-local apps/api-server
docker compose --env-file .env.prod -f compose.prod.yaml up -d api-server nginx

for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS http://localhost:18080/actuator/health > /dev/null 2>&1; then
        echo "Health check passed"
        exit 0
    fi

    echo "Waiting for api-server health..."
    sleep 3
done

echo "Health check failed"
docker compose --env-file .env.prod -f compose.prod.yaml logs --tail=100 api-server
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
                    action  : 'api-server Deploy',
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
                    if (details.length() > 4000) {
                        details = details.substring(details.length() - 4000)
                    }
                } catch (err) {
                    details = "Error log collection failed: ${err}"
                }

                sendMMNotify(false, [
                    mention    : '@here',
                    branch     : env.GIT_BRANCH,
                    commit     : env.COMMIT_MSG ?: '',
                    duration   : duration,
                    action     : 'api-server Deploy',
                    failedStage: env.FAILED_STAGE ?: 'unknown',
                    details    : details,
                    buildUrl   : env.BUILD_URL
                ])
            }
        }

        always {
            deleteDir()
        }
    }
}
