def sendMattermostNotify(String result) {
    try {
        def success = result == 'SUCCESS'
        def color = success ? '#36a64f' : '#dc3545'
        def statusText = success ? 'succeeded' : 'failed'

        def payload = [
            username   : 'Jenkins',
            icon_emoji : ':jenkins:',
            text       : "Wedge api-server deployment ${statusText}",
            attachments: [[
                color : color,
                fields: [
                    [short: false, title: 'Result', value: result],
                    [short: false, title: 'Job', value: "${env.JOB_NAME} #${env.BUILD_NUMBER}"],
                    [short: false, title: 'Branch', value: env.GIT_BRANCH],
                    [short: false, title: 'Build', value: env.BUILD_URL]
                ]
            ]]
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
        echo "Mattermost notification failed: ${err}"
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
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: "${GIT_BRANCH}",
                    credentialsId: 'gitlab-https',
                    url: "${GIT_URL}"
            }
        }

        stage('Docker Info') {
            steps {
                sh 'docker version'
            }
        }

        stage('Build Image') {
            steps {
                sh 'docker build -f apps/api-server/Dockerfile -t "${IMAGE_NAME}:ci-${BUILD_NUMBER}" apps/api-server'
            }
        }

        stage('Deploy to EC2') {
            steps {
                withCredentials([sshUserPrivateKey(
                    credentialsId: 'ec2-ssh',
                    keyFileVariable: 'EC2_KEY',
                    usernameVariable: 'EC2_USER'
                )]) {
                    sh '''
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
                    '''
                }
            }
        }
    }

    post {
        always {
            script {
                sendMattermostNotify(currentBuild.currentResult ?: 'SUCCESS')
            }
            deleteDir()
        }
    }
}
