#!/usr/bin/env bash
set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

${PROJECT_DIR}/../../common/scripts/check-dev-aws-credentials.sh

# we build docker image from root directory to include shared dependencies
cd "../../"

APP_NAME=govuk-chat-chat-api-fastapi
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$APP_NAME

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REPO

# This may be something we want to move to a CDK stack
if ! aws ecr describe-repositories --repository-names $APP_NAME --region $AWS_REGION >/dev/null 2>&1; then
    echo "== Creating ECR repository for $APP_NAME  =="
    aws ecr create-repository --repository-name $APP_NAME --region $AWS_REGION --no-cli-pager
fi

docker build --platform linux/amd64 \
             --build-arg SOURCE_DATE_EPOCH=0 \
             --provenance=false \
             --tag $REPO:latest \
             --file services/chat-api-fastapi/Dockerfile \
             .

docker push $REPO:latest
